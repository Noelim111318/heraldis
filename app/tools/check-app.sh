#!/usr/bin/env bash
# Controle rapide d'UNE app (pas du moteur) avant de la livrer.
# Zero dependance a installer ; ce qui manque (node, python3, git) est saute.
#
#   ./tools/check-app.sh [dossier-app] [--compat <revision-git>]
#
# Verifie : syntaxe JS, manifest JSON, versions alignees (app.js, service-worker.js,
# index.html, manifest.json), APP_SHELL = fichiers servis, identifiants d'elements
# utilises par le JS presents dans index.html, jetons de template egares.
#
# --compat <rev> (ex. --compat HEAD, --compat v1.2.0) : verifie aussi que les
# identifiants qui existaient dans index.html a cette revision existent toujours.
# Pendant une mise a jour, l'ancien JS (encore en cache chez certains) s'execute
# quelques instants sur le NOUVEAU html : un identifiant renomme le fait planter
# avant de cabler l'accueil. On ne renomme donc pas les identifiants (on en ajoute).

set -uo pipefail

DIR="."
COMPAT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --compat) COMPAT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) DIR="$1"; shift ;;
  esac
done
[ -d "$DIR" ] || { echo "dossier introuvable : $DIR" >&2; exit 2; }
cd "$DIR"
[ -f index.html ] && [ -f app.js ] || { echo "pas une app pwa-engine ici (index.html / app.js manquants) : $PWD" >&2; exit 2; }
fail=0

echo "· JS  (node --check)"
if command -v node >/dev/null 2>&1; then
  for f in app.js data.js service-worker.js words.js engine/*.js; do
    [ -f "$f" ] || continue
    if node --check "$f" 2>/dev/null; then echo "  ok  $f"; else echo "  KO  $f"; fail=1; fi
  done
else
  echo "  (node absent — saute)"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "· (python3 absent — versions, APP_SHELL et identifiants sautes)"
else
  echo "· Manifest JSON et versions"
  python3 - <<'PY' || fail=1
import json, re, sys
ok = True
def rd(p):
    try: return open(p, encoding='utf-8').read()
    except OSError: return None
found = {}
js = rd('app.js');            m = js and re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", js)
if m: found['app.js'] = m.group(1)
sw = rd('service-worker.js'); m = sw and re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", sw)
if m: found['service-worker.js'] = m.group(1)
html = rd('index.html')
m = html and re.search(r'name="app-version"\s+content="([^"]*)"', html)
if m: found['index.html (meta)'] = m.group(1)
m = html and re.search(r'id="app-version"[^>]*>([^<]*)<', html)
if m: found['index.html (badge)'] = m.group(1).strip()
mani = rd('manifest.json')
try:
    mj = json.loads(mani) if mani else None
    print("  ok  manifest.json (JSON valide)")
    if mj and mj.get('version'): found['manifest.json'] = mj['version']
except ValueError as e:
    print("  KO  manifest.json invalide : %s" % e); ok = False
vals = set(found.values())
if len(vals) <= 1:
    print("  ok  versions alignees (%s) : %s" % (next(iter(vals)) if vals else '?', ', '.join(sorted(found))))
else:
    ok = False
    print("  KO  versions differentes : " + " ; ".join("%s=%s" % kv for kv in sorted(found.items())))
    print("      -> ./tools/bump-version.sh vX.Y.Z")
sys.exit(0 if ok else 1)
PY

  echo "· Coherence APP_SHELL (service-worker.js)"
  python3 - <<'PY' || fail=1
import os, re, sys
sw = open('service-worker.js', encoding='utf-8').read()
m = re.search(r'APP_SHELL\s*=\s*\[(.*?)\]', sw, re.S)
shell = set(re.findall(r"'\./([^']*)'", m.group(1))) if m else set()
shell.discard('')
missing = sorted(p for p in shell if not os.path.exists(p))
SKIPDIR = {'tools', '.git', '.github', 'node_modules', '__pycache__'}
SKIPFILE = {'README.md', '.gitignore', '.version', 'LICENSE', 'service-worker.js', '.editorconfig'}
present = set()
for dp, dns, fns in os.walk('.'):
    dns[:] = [d for d in dns if d not in SKIPDIR]
    for fn in fns:
        if fn in SKIPFILE or fn.endswith('.md') or fn.endswith('.tmp'):
            continue
        present.add(os.path.relpath(os.path.join(dp, fn), '.').replace(os.sep, '/'))
absent = sorted(present - shell)
ok = True
if missing:
    ok = False; print("  KO  APP_SHELL liste des fichiers absents : " + ", ".join(missing))
if absent:
    ok = False; print("  KO  fichiers servis hors APP_SHELL : " + ", ".join(absent))
if ok: print("  ok  %d entrees, tout concorde" % len(shell))
sys.exit(0 if ok else 1)
PY

  echo "· Identifiants d'elements (app.js -> index.html)"
  COMPAT="$COMPAT" python3 - <<'PY' || fail=1
import os, re, subprocess, sys
js = open('app.js', encoding='utf-8').read()
html = open('index.html', encoding='utf-8').read()
in_html = set(re.findall(r'\bid="([^"]+)"', html))
# identifiants crees par le JS lui-meme (element.id = 'x', setAttribute('id', 'x'))
created = set(re.findall(r"\.id\s*=\s*['\"]([\w-]+)['\"]", js)) | set(re.findall(r"setAttribute\(\s*['\"]id['\"]\s*,\s*['\"]([\w-]+)['\"]", js))
pat = re.compile(r"""getElementById\(\s*['"]([\w-]+)['"]|\$\(\s*['"]#([\w-]+)['"]|querySelector(?:All)?\(\s*['"]#([\w-]+)""")
used = {}
for i, line in enumerate(js.splitlines(), 1):
    for m in pat.finditer(line):
        used.setdefault(next(g for g in m.groups() if g), i)
missing = sorted((n, l) for n, l in used.items() if n not in in_html and n not in created)
ok = True
if missing:
    ok = False
    print("  KO  identifiants utilises par app.js mais absents de index.html :")
    for n, l in missing: print("        #%s  (app.js ligne %d)" % (n, l))
else:
    print("  ok  %d identifiants utilises, tous presents dans index.html" % len(used))

rev = os.environ.get('COMPAT', '')
if rev:
    try:
        old = subprocess.run(['git', 'show', rev + ':index.html'], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        print("  (--compat %s : index.html introuvable a cette revision — saute)" % rev)
    else:
        old_ids = set(re.findall(r'\bid="([^"]+)"', old))
        gone = sorted(old_ids - in_html)
        if gone:
            ok = False
            print("  KO  identifiants presents a %s et disparus (renommes ou supprimes) : %s" % (rev, ", ".join(gone)))
            print("      Pendant une mise a jour, l'ancien JS s'execute un moment sur ce HTML : garde ces identifiants.")
        else:
            print("  ok  aucun identifiant retire depuis %s (%d identifiants d'alors)" % (rev, len(old_ids)))
sys.exit(0 if ok else 1)
PY
fi

echo "· Jetons de template egares"
if grep -lE '__(APP_[A-Z]+|THEME_COLOR)__' index.html app.js app.css data.js manifest.json service-worker.js diag.html README.md >/dev/null 2>&1; then
  echo "  KO  un jeton __APP_*/__THEME_COLOR__ n'a pas ete substitue :"
  grep -nE '__(APP_[A-Z]+|THEME_COLOR)__' index.html app.js app.css data.js manifest.json service-worker.js diag.html README.md 2>/dev/null | sed 's/^/     /'
  fail=1
else
  echo "  ok  aucun"
fi

echo
if [ "$fail" = 0 ]; then echo "OK"; else echo "ECHEC"; exit 1; fi
