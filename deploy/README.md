# 官网部署

官网 `tracker.eonmaze.com` 是纯静态页面：产品介绍和安装说明，安装按钮指向 Edge 加载项和 Chrome 应用商店。它不存任何账号，也不处理任何请求，扩展本身不依赖它。

线上约定（与 eonmaze.com 的其他站点一致）：dmit 服务器上的 nginx，Cloudflare 代理；443 端口被别的服务占用，站点走 8443；证书是 Let's Encrypt，webroot `/var/www/acme`，由 80 端口的默认站点负责验证，certbot 自动续期。

## 首次部署（已完成，记录在这里便于重建）

1. **域名**：Cloudflare 上 `tracker` 的 A / AAAA 记录指向服务器，开启代理（橙色云）；SSL 模式为 Full。443 端口被占，所以加一条 Origin Rule：`(http.host eq "tracker.eonmaze.com" and ssl)` 回源到 8443。条件里的 `and ssl` 让 http 请求仍走 80 端口，证书续期的 ACME 验证才能通过。
2. **nginx**：把 `deploy/nginx.conf` 复制到 `/etc/nginx/sites-available/manuscript-tracker.conf`，软链到 `sites-enabled/`，`nginx -t && systemctl reload nginx`。它包含两部分：80 端口负责 ACME 验证、其余跳转 https；8443 端口提供页面。
3. **证书**：`certbot certonly --webroot -w /var/www/acme -d tracker.eonmaze.com`，之后由 certbot 定时任务自动续期，续期后需要 `systemctl reload nginx`（服务器上的 deploy hook 已经处理）。
4. **发布页面**：在本机运行 `npm run deploy:site`。

## 更新官网

改了页面后运行 `npm run deploy:site`。它会：

1. 生成页面到 `dist/site/`，填入版本号，并逐个查询两个商店：已上架的放安装按钮，还没上架的显示“审核中”。两个扩展 ID 写在 `scripts/build-site.sh` 开头。商店审核通过后重新部署一次，按钮就会出现；
2. 上传到 `/var/www/manuscript-tracker.new`，整体替换线上目录，不保留旧版本。需要回滚时，用 git 检出旧版本后重新运行 `npm run deploy:site`。

服务器和目录可以用环境变量 `SITE_HOST`、`SITE_DIR` 覆盖。

## 发布扩展新版本

扩展只从 Edge 加载项和 Chrome 应用商店分发，两个商店会自动给用户更新。

1. 改 `manifest.json` 的版本号，`npm test`，提交并推送；
2. `npm run publish:stores`：打包（去掉 manifest 里的 `key`），上传到两个商店并提交审核。`-- --edge` 或 `-- --chrome` 只发一个，`-- --check` 只检查凭据，`-- --status` 查看 Chrome 的审核状态；
3. 打 tag、在 GitHub 写 Release 说明（不再附 zip）；页面有改动时再 `npm run deploy:site`。

商店详情页的文字、截图和隐私声明 API 改不了，要在各自后台手动改：Edge 在 [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)，Chrome 在[开发者后台](https://chrome.google.com/webstore/devconsole)。

### 凭据（一次性设置）

`npm run publish:stores` 从 `~/.config/mituan/stores.env`（权限 600，不在仓库里）读取：

```ini
# Edge：Partner Center → Microsoft Edge → 发布 API → 创建 API 凭据。API key 有到期日，到期前在同一页续期
EDGE_PRODUCT_ID=15ef34d6-806d-4673-a2c5-2f250d106974
EDGE_CLIENT_ID=
EDGE_API_KEY=
# Chrome：开发者后台账号页的发布者 ID、扩展 ID、服务账号 JSON 密钥的路径
CHROME_PUBLISHER_ID=
CHROME_ITEM_ID=cgegoafnapldoacegnnapjbhpfnmjijo
CHROME_SERVICE_ACCOUNT=~/.config/mituan/chrome-service-account.json
```

注释只能单独占一行，不能写在值的后面。

Chrome 用服务账号：在 Google Cloud Console 新建项目，启用 Chrome Web Store API，创建一个不分配任何角色的服务账号，给它添加 JSON 密钥并下载；再在 Chrome 开发者后台的 Account 页把服务账号的邮箱加进去。

## 扩展 ID

两个商店各自分配扩展 ID：Edge 是 `hkljgniplahnifceaoaehfkefbcilmpd`，Chrome 是 `cgegoafnapldoacegnnapjbhpfnmjijo`。商店不接受带 `key` 的包，`npm run package` 打包时会去掉它。

仓库里的 `manifest.json` 保留了 `key`，只用于开发：`npm run deploy` 复制到本机目录后以「加载解压缩的扩展」加载，扩展 ID 固定为 `dohmncmimffpejlgnfellofohdnngppm`，换目录也不变。对应的私钥不在仓库里。0.5.0、0.5.1 曾经提供 zip 手动安装，那些用户需要移除旧版、从商店重新安装。
