"""Inventory the submission without reading Git internals or dependency/cache trees."""
import json
import os
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 8_388_608
EXCLUDED = {".git", ".github", ".imd", ".agents", ".codex", ".aws", "node_modules", ".npm", ".pnpm-store", ".yarn", ".cache", ".vite", "__pycache__", ".venv", "venv", ".playwright-mcp", "playwright-report", "test-results"}


def files():
    out = []
    for directory, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in EXCLUDED and not (Path(directory).relative_to(ROOT).as_posix() == "test" and d == "scratch")]
        for name in names:
            path = Path(directory, name)
            if name.startswith('.env') or name.endswith((".pyc", ".log", ".sqlite3", ".sqlite3-shm", ".sqlite3-wal", ".tsbuildinfo")):
                continue
            if path.is_symlink():
                raise SystemExit(f"Unexpected submission symlink: {path.relative_to(ROOT)}")
            if name.endswith((".tgz", ".zip", ".whl")):
                raise SystemExit(f"Unexpected dependency/archive artifact: {path.relative_to(ROOT)}")
            out.append(path)
    return sorted(out)


report_path = ROOT / "artifacts/budget.json"
report_path.parent.mkdir(exist_ok=True)
report_path.write_text("{}\n")
for _ in range(4):
    candidates = files()
    total = sum(path.stat().st_size for path in candidates)
    export = sum(path.stat().st_size for path in candidates if "dist" == path.relative_to(ROOT).parts[0])
    report = {"limitBytes": LIMIT, "totalUncompressedFileBytes": total, "exportBytes": export, "fileCount": len(candidates), "reservedPackagingBytes": 1_048_576, "withinBudgetWithReserve": total + 1_048_576 <= LIMIT, "files": [{"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size} for path in candidates]}
    report_path.write_text(json.dumps(report, indent=2) + "\n")
if not report["withinBudgetWithReserve"]:
    raise SystemExit(f"Submission exceeds budget with packaging reserve: {total:,} bytes")
archive = Path('/tmp/pulse-submission-check.tar.gz')
with tarfile.open(archive, 'w:gz') as bundle:
    for path in files():
        bundle.add(path, arcname=str(path.relative_to(ROOT)))
print(json.dumps({"sourceAndExportBytes": total, "exportBytes": export, "compressedCheckArchiveBytes": archive.stat().st_size, "limitBytes": LIMIT, "result": "PASS"}, indent=2))
