#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Uses the local SSH alias; no server credentials are stored in this repo.
npm run typecheck
npm run build
release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
staging=$(ssh -o BatchMode=yes ubuntu-gj-sh 'mktemp -d /tmp/njzfly.XXXXXXXX')
[[ "$staging" == /tmp/njzfly.* ]] || exit 1
rsync -rz --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --exclude='._*' --exclude='.DS_Store' \
  dist/ "ubuntu-gj-sh:$staging/"

ssh -o BatchMode=yes ubuntu-gj-sh bash -s -- "$staging" "$release" <<'REMOTE'
set -euo pipefail
staging=$1
release=$2
[[ "$staging" == /tmp/njzfly.* ]] && [[ "$release" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]+$ ]]
test -f "$staging/index.html"
sudo install -d -m 0755 /var/www/njzfly/releases
destination="/var/www/njzfly/releases/$release"
test ! -e "$destination"
sudo mv "$staging" "$destination"
sudo chown -R root:root "$destination"
sudo chmod 0755 "$destination"
sudo ln -s "$destination" "/var/www/njzfly/current-$release"
sudo mv -Tf "/var/www/njzfly/current-$release" /var/www/njzfly/current
printf '已发布：%s\n' "$destination"
REMOTE

curl --fail --silent --show-error --output /dev/null \
  --write-out 'HTTPS 状态：%{http_code}\n' https://njzfly.wystudio.zone/
