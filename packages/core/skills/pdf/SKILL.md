---
name: pdf
description: Read/extract/combine/split PDFs.
---

# pdf

Common PDF ops without bringing in a heavyweight Node dependency. Use
the OS-bundled tools (macOS) or `pdftk` (Linux) via Bash.

## When to invoke

- User says "extract page X", "merge these PDFs", "summarize this PDF",
  "remove page Y from foo.pdf".

## Tools

| Op                   | macOS                                              | Linux (pdftk)                                  |
| -------------------- | -------------------------------------------------- | ---------------------------------------------- |
| Extract pages 2-5    | `cpdf in.pdf 2-5 -o out.pdf` (needs cpdf)          | `pdftk in.pdf cat 2-5 output out.pdf`          |
| Merge a, b, c        | (PDF Toolkit / cpdf)                                | `pdftk a.pdf b.pdf c.pdf cat output merged.pdf` |
| Split per page       | `cpdf -split in.pdf -o page-%d.pdf`                | `pdftk in.pdf burst output page-%02d.pdf`      |
| Text dump            | `pdftotext in.pdf -` (needs poppler)               | same                                           |
| Page count           | `pdftk in.pdf dump_data | grep NumberOfPages`      | same                                           |

If neither `cpdf` nor `pdftk` is installed, use Python + `pypdf` (one
dep, pure Python):

```bash
python3 -c "
from pypdf import PdfReader, PdfWriter
r = PdfReader('in.pdf')
w = PdfWriter()
for p in r.pages[1:5]:  # pages 2-5 (0-indexed)
    w.add_page(p)
w.write(open('out.pdf', 'wb'))
"
```

## Reading content for the agent

For summarization, extract text first, then feed it to the model. Use
`pdftotext in.pdf -` (poppler) which writes to stdout — easy to capture
in Bash output.

If the PDF is scanned (image-only), text extraction returns empty/garbage.
Tell the user: "this PDF is scanned; you'd need OCR via tesseract first"
rather than producing nonsense.

## Anti-patterns

- Don't write a full Node PDF parser inline — use the CLI tool.
- Don't try to OCR scanned PDFs without explicitly opting in (slow + needs
  the language pack).
