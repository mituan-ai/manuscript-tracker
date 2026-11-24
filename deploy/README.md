# 官网部署

官网 `tracker.eonmaze.com` 是纯静态页面：产品介绍、安装教程和扩展 zip 下载。它不存任何账号，也不处理任何请求，扩展本身不依赖它。

线上约定（与 eonmaze.com 的其他站点一致）：dmit 服务器上的 nginx，Cloudflare 代理；443 端口被别的服务占用，站点走 8443；证书是 Let's Encrypt，webroot `/var/www/acme`，由 80 端口的默认站点负责验证，certbot 自动续期。

## 首次部署（已完成，记录在这里便于重建）

1. **域名**：Cloudflare 上 `tracker` 的 A / AAAA 记录指向服务器，开启代理（橙色云）；SSL 模式为 Full。443 端口被占，所以加一条 Origin Rule：`(http.host eq "tracker.eonmaze.com" and ssl)` 回源到 8443。条件里的 `and ssl` 让 http 请求仍走 80 端口，证书续期的 ACME 验证才能通过。
2. **nginx**：把 `deploy/nginx.conf` 复制到 `/etc/nginx/sites-available/manuscript-tracker.conf`，软链到 `sites-enabled/`，`nginx -t && systemctl reload nginx`。它包含两部分：80 端口负责 ACME 验证、其余跳转 https；8443 端口提供页面。
3. **证书**：`certbot certonly --webroot -w /var/www/acme -d tracker.eonmaze.com`，之后由 certbot 定时任务自动续期，续期后需要 `systemctl reload nginx`（服务器上的 deploy hook 已经处理）。
4. **发布页面**：在本机运行 `npm run deploy:site`。

## 更新

改了扩展或页面后，先改 `manifest.json` 的版本号，再运行 `npm run deploy:site`。它会：

1. 把扩展打包，放到 `download/manuscript-tracker.zip`（文件名不带版本号，用户更新时解压出来的文件夹名不变），另存一份 `manuscript-tracker-latest.zip` 兼容旧链接；
2. 生成页面，把版本号和 zip 大小填进下载区；
3. 上传到 `/var/www/manuscript-tracker.new`，整体替换线上目录，不保留旧版本。需要回滚时，用 git 检出旧版本后重新运行 `npm run deploy:site`。

服务器和目录可以用环境变量 `SITE_HOST`、`SITE_DIR` 覆盖。

## 扩展 ID 和商店包

`manifest.json` 里的 `key` 固定了手动安装时的扩展 ID（`dohmncmimffpejlgnfellofohdnngppm`），与解压到哪个文件夹无关。用户更新时，账号和记录都存在这个 ID 下，所以 `key` 不能改，也不能删。对应的私钥不在仓库里，由维护者另行保管，只有签名 CRX 时才用得到。

扩展商店不接受带 `key` 的包，商店会自己分配 ID。上架或更新 Edge 加载项时运行 `npm run package:store`，上传生成的 `dist/manuscript-tracker-<版本>-store.zip`。从商店安装的扩展和手动安装的是两个不同的扩展，数据不互通。
