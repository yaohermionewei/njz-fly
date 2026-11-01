# 腾讯云部署

- 网址：<https://njzfly.wystudio.zone/>
- 主机：`111.231.6.133`；本机 SSH 别名：`ubuntu-gj-sh`
- 网站根目录：`/var/www/njzfly/current`，指向 `releases/` 中一个完整版本
- Nginx：`/etc/nginx/sites-available/njzfly`，由同名 `sites-enabled` 软链接启用
- DNSPod：`wystudio.zone` 下 `njzfly` 的 A 记录指向服务器，TTL 为600秒

## 更新代码

```bash
npm ci
npm test
npm run deploy
```

发布脚本会检查类型、构建、上传到新的版本目录，最后原子切换 `current`。服务器文件由 root 所有，Nginx 只读。脚本不会修改 Nginx 或其他网站；GitHub Actions 仅做检查和归档，不保存本机 SSH 私钥。

## 回滚

先用 `ssh ubuntu-gj-sh 'ls -1 /var/www/njzfly/releases'` 找到所需版本。将 `current` 切换到选中的完整版本即可，Nginx无需重启；不要删除仍可能被浏览器使用的旧版本。

## HTTPS 与续期

证书路径为 `/etc/letsencrypt/live/njzfly.wystudio.zone/`，Certbot使用 `/var/www/letsencrypt` 的 HTTP 验证路径。80端口仅保留验证路径，其余请求跳转HTTPS。

现有 `certbot.timer` 定时续期；服务器已有的全局 deploy hook 在证书更新后执行 `nginx -t` 并 reload。可单独验证本网站续期：

```bash
ssh ubuntu-gj-sh 'sudo certbot renew --cert-name njzfly.wystudio.zone --dry-run --run-deploy-hooks'
```

Nginx配置模板见 [njzfly.nginx](njzfly.nginx)。首次启用前必须已有证书和 `current` 软链接；替换配置后先 `sudo nginx -t`，成功后再 reload。
