#!/usr/bin/env bash
# DIAGNOSTIC PoC for the Linux selective-network-allowlist sandbox.
# NOT part of the product — a throwaway probe run in CI (Linux only) to nail
# down the exact bwrap + slirp4netns + DNS-proxy mechanics before encoding them
# in TypeScript (packages/core/src/sandbox/netns.ts). Removed once proven.
#
# Proves the full flow:
#   bwrap --unshare-net  (own netns, no connectivity)
#     + slirp4netns       (userspace NAT → outbound connectivity, rootless)
#     + allowlisting DNS   (resolv.conf → host proxy; NXDOMAIN for non-allowed)
#   => allowed domain resolves+connects; denied domain fails to resolve.
#
# HANG-PROOF: no blocking FIFO (a `sleep` window covers slirp configuration),
# a background watchdog hard-kills the sandbox, and a trap always cleans up.
# Everything is best-effort + verbose so one CI run reveals what works.

set -uo pipefail

say() { echo ""; echo "===== $* ====="; }

DNS_PID=""; SLIRP_PID=""; BWRAP_PID=""; WATCH_PID=""; WORK=""
cleanup() {
  [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null || true
  [ -n "$BWRAP_PID" ] && kill "$BWRAP_PID" 2>/dev/null || true
  [ -n "$SLIRP_PID" ] && kill "$SLIRP_PID" 2>/dev/null || true
  [ -n "$DNS_PID" ] && kill "$DNS_PID" 2>/dev/null || true
  [ -n "$WORK" ] && rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

say "versions"
bwrap --version || true
slirp4netns --version || true
python3 --version || true

say "bwrap help — fd handshake flags"
bwrap --help 2>&1 | grep -iE "info-fd|block-fd|sync-fd|userns-block|unshare-net|--chdir" || true

say "slirp4netns help — config/ready/dns flags"
slirp4netns --help 2>&1 | grep -iE "ready-fd|configure|disable-host-loopback|mtu|netns|--dns|outbound" || true

say "unprivileged port start (need <=53 to bind :53 rootless)"
sysctl net.ipv4.ip_unprivileged_port_start 2>/dev/null || true
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=53 || true

# ── workspace ───────────────────────────────────────────────────────────────
WORK="$(mktemp -d)"
CWD="$WORK/cwd"; mkdir -p "$CWD"
echo "nameserver 10.0.2.2" > "$WORK/resolv.conf"   # slirp gateway → host loopback
echo "WORK=$WORK"

# /etc/resolv.conf is usually a dangling symlink (→ /run/systemd/resolve/...)
# which bwrap can't create a bind target for. Bind our file at the symlink's
# RESOLVED real path so the preserved /etc/resolv.conf symlink leads to it.
say "resolv.conf shape on host"
ls -l /etc/resolv.conf || true
RP="$(readlink -f /etc/resolv.conf 2>/dev/null || true)"
[ -n "$RP" ] || RP=/etc/resolv.conf
echo "resolv real path RP=$RP"

# ── allowlisting DNS proxy on host 127.0.0.1:53 (allow example.com only) ──────
say "start allowlist DNS proxy on 127.0.0.1:53"
cat > "$WORK/dns.py" <<'PY'
import socket
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
kill -0 "$DNS_PID" 2>/dev/null || echo "!! DNS proxy failed to start (port 53 bind?)"

# ── bwrap with own netns; inner cmd sleeps to let slirp configure, then curls ─
say "spawn bwrap (--unshare-net), capture child-pid via --info-fd"
INNER='sleep 3
echo "--- inside sandbox: interfaces ---"
ip addr 2>/dev/null | grep -E "tap0|inet " || echo "(no ip tool / no addrs)"
echo "--- resolv.conf ---"; cat /etc/resolv.conf
echo "--- curl ALLOWED (example.com) ---"
curl -sS --max-time 10 -o /dev/null -w "allowed_http=%{http_code}\n" https://example.com 2>&1 || echo "allowed_curl_exit=$?"
echo "--- curl DENIED (github.com) ---"
curl -sS --max-time 10 -o /dev/null -w "denied_http=%{http_code}\n" https://github.com 2>&1 || echo "denied_curl_exit=$?"
echo "--- sandbox inner done ---"'

bwrap \
  --ro-bind-try /usr /usr --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
  --ro-bind-try /bin /bin --ro-bind-try /sbin /sbin --ro-bind-try /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$WORK/resolv.conf" "$RP" \
  --bind "$CWD" "$CWD" \
  --unshare-net --unshare-pid --unshare-ipc --unshare-uts \
  --new-session --die-with-parent \
  --info-fd 8 \
  /bin/sh -c "$INNER" 8>"$WORK/info.json" &
BWRAP_PID=$!
echo "bwrap host pid=$BWRAP_PID"

# watchdog: hard-kill the sandbox after 45s no matter what
( sleep 45; kill "$BWRAP_PID" 2>/dev/null ) &
WATCH_PID=$!

# wait for info.json, extract child-pid
for _ in $(seq 1 50); do [ -s "$WORK/info.json" ] && break; sleep 0.1; done
echo "--- info.json ---"; cat "$WORK/info.json" 2>/dev/null || echo "(empty)"
CHILD_PID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["child-pid"])' "$WORK/info.json" 2>/dev/null || echo "")"
echo "child-pid=$CHILD_PID"

if [ -n "$CHILD_PID" ]; then
  say "start slirp4netns attached to child-pid=$CHILD_PID"
  # --disable-dns closes the 10.0.2.3 host-DNS bypass so ALL resolution must go
  # through our allowlisting proxy (guest resolv.conf points only at 10.0.2.2).
  slirp4netns --configure --disable-dns --mtu=65520 "$CHILD_PID" tap0 &
  SLIRP_PID=$!
  echo "slirp pid=$SLIRP_PID (inner sleeps 3s to let it configure)"
else
  echo "!! no child-pid; cannot attach slirp (curls will fail)"
fi

say "wait for sandbox to finish (bounded by 45s watchdog)"
wait "$BWRAP_PID" 2>/dev/null; echo "bwrap exit=$?"
echo "PoC done."
