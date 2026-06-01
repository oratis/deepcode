#!/usr/bin/env bash
# DIAGNOSTIC PoC for the Linux selective-network-allowlist sandbox.
# NOT part of the product — this is a throwaway probe run in CI (Linux only) to
# nail down the exact bwrap + slirp4netns + DNS-proxy mechanics before encoding
# them in TypeScript (packages/core/src/sandbox/netns.ts). Removed once proven.
#
# Proves the full flow:
#   bwrap --unshare-net  (own netns, no connectivity)
#     + slirp4netns       (userspace NAT → outbound connectivity, rootless)
#     + allowlisting DNS   (resolv.conf → host proxy; NXDOMAIN for non-allowed)
#   => allowed domain resolves+connects; denied domain fails to resolve.
#
# Everything is best-effort + verbose so one CI run reveals what works.

set -uo pipefail

say() { echo ""; echo "===== $* ====="; }

say "versions"
bwrap --version || true
slirp4netns --version || true
python3 --version || true

say "bwrap help — fd handshake flags"
bwrap --help 2>&1 | grep -iE "info-fd|block-fd|sync-fd|userns-block|unshare-net|--bind|--chdir" || true

say "slirp4netns help — config/ready/dns flags"
slirp4netns --help 2>&1 | grep -iE "ready-fd|configure|disable-host-loopback|mtu|netns|--dns|outbound" || true

say "unprivileged port start (need <=53 to bind :53 rootless)"
sysctl net.ipv4.ip_unprivileged_port_start 2>/dev/null || true
echo "relaxing to 53 for the proxy..."
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=53 || true

# ── workspace ───────────────────────────────────────────────────────────────
WORK="$(mktemp -d)"
CTL="$WORK/ctl"; mkdir -p "$CTL"
mkfifo "$CTL/net-ready"
CWD="$WORK/cwd"; mkdir -p "$CWD"
echo "nameserver 10.0.2.2" > "$WORK/resolv.conf"   # slirp gateway → host loopback
echo "WORK=$WORK"

# ── allowlisting DNS proxy on host 127.0.0.1:53 (allow example.com only) ──────
say "start allowlist DNS proxy on 127.0.0.1:53"
cat > "$WORK/dns.py" <<'PY'
import socket, struct, sys
ALLOW = {"example.com", "www.example.com"}
UP = ("1.1.1.1", 53)
def qname(b):
    i, parts = 12, []
    while i < len(b):
        n = b[i]
        if n == 0: break
        parts.append(b[i+1:i+1+n].decode("latin1")); i += 1+n
    return ".".join(parts).lower().rstrip(".")
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", 53))
print("dns-proxy listening :53", flush=True)
while True:
    try:
        data, addr = s.recvfrom(2048)
        name = qname(data)
        if name in ALLOW:
            print(f"ALLOW {name}", flush=True)
            u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(5)
            u.sendto(data, UP)
            try: resp,_ = u.recvfrom(2048); s.sendto(resp, addr)
            except Exception as e: print("upstream err", e, flush=True)
            u.close()
        else:
            print(f"DENY  {name}", flush=True)
            r = bytearray(data[:12]); r[2]=0x81; r[3]=0x83  # QR=1, RCODE=3 NXDOMAIN
            s.sendto(bytes(r)+data[12:], addr)
    except Exception as e:
        print("proxy err", e, flush=True)
PY
python3 "$WORK/dns.py" &
DNS_PID=$!
sleep 0.5
if ! kill -0 "$DNS_PID" 2>/dev/null; then echo "!! DNS proxy failed to start (port 53 bind?)"; fi

# ── bwrap with own netns; inner cmd waits for slirp readiness via FIFO ────────
say "spawn bwrap (--unshare-net), capture child-pid via --info-fd"
INNER='cat /dc-ctl/net-ready >/dev/null 2>&1
echo "--- inside sandbox: interfaces ---"
ip addr show 2>/dev/null | grep -E "tap0|inet " || true
echo "--- resolv.conf ---"; cat /etc/resolv.conf
echo "--- curl ALLOWED (example.com) ---"
curl -sS --max-time 12 -o /dev/null -w "allowed_http=%{http_code}\n" https://example.com 2>&1 || echo "allowed_curl_exit=$?"
echo "--- curl DENIED (github.com) ---"
curl -sS --max-time 12 -o /dev/null -w "denied_http=%{http_code}\n" https://github.com 2>&1 || echo "denied_curl_exit=$?"
echo "--- direct-IP DENIED-domain note (raw IP bypasses DNS allowlist; expected) ---"'

# info-fd → fd 8 → a file we read for child-pid JSON
bwrap \
  --ro-bind-try /usr /usr --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
  --ro-bind-try /bin /bin --ro-bind-try /sbin /sbin --ro-bind-try /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$WORK/resolv.conf" /etc/resolv.conf \
  --ro-bind "$CTL" /dc-ctl \
  --bind "$CWD" "$CWD" \
  --unshare-net --unshare-pid --unshare-ipc --unshare-uts \
  --new-session --die-with-parent \
  --info-fd 8 \
  /bin/sh -c "$INNER" 8>"$WORK/info.json" &
BWRAP_PID=$!
echo "bwrap host pid=$BWRAP_PID"

# wait for info.json to be populated, then extract child-pid
for _ in $(seq 1 50); do [ -s "$WORK/info.json" ] && break; sleep 0.1; done
echo "--- info.json ---"; cat "$WORK/info.json" 2>/dev/null || echo "(empty)"
CHILD_PID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["child-pid"])' "$WORK/info.json" 2>/dev/null || echo "")"
echo "child-pid=$CHILD_PID"

if [ -n "$CHILD_PID" ]; then
  say "start slirp4netns attached to child-pid=$CHILD_PID"
  slirp4netns --configure --mtu=65520 --ready-fd=9 "$CHILD_PID" tap0 9>"$WORK/slirp-ready" &
  SLIRP_PID=$!
  # wait for slirp ready byte
  for _ in $(seq 1 50); do [ -s "$WORK/slirp-ready" ] && break; sleep 0.1; done
  echo "slirp ready marker present: $([ -s "$WORK/slirp-ready" ] && echo yes || echo no)"
  sleep 0.3
  say "signal sandbox to proceed (open FIFO for write)"
  echo go > "$CTL/net-ready"
else
  echo "!! no child-pid; cannot attach slirp"
  echo go > "$CTL/net-ready" 2>/dev/null || true
fi

say "wait for sandbox to finish"
wait "$BWRAP_PID" 2>/dev/null; echo "bwrap exit=$?"

say "cleanup"
kill "$SLIRP_PID" 2>/dev/null || true
kill "$DNS_PID" 2>/dev/null || true
rm -rf "$WORK" || true
echo "PoC done."
