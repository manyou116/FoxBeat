# OTA 更新与发布

FoxBeat 使用公开 GitHub Releases 发现版本，使用 Tauri 官方 updater 下载、验证并安装。原生后台在启动 15 秒后检查，之后每 6 小时检查；界面关闭到托盘时仍可检查。自动检查失败只记录状态，不弹出打扰窗口。安装需要用户确认，Windows 使用 NSIS passive 安装，macOS 替换当前应用后重启。

版本按 SemVer 比较，过滤草稿、相同版本和旧版本。“接收开发预览版”同时控制 GitHub prerelease 和 SemVer 预发布版本。当前流水线发布开发预览版，因此默认启用该开关。清单从所选版本的附件读取，不使用 GitHub 的 `/releases/latest`，后者不包含开发预览版。

## 一次性签名配置

仓库配置只包含验证公钥；私钥和密码必须保存在仓库之外并备份。首次配置可执行：

```sh
npm run tauri -- signer generate --write-keys /path/outside-repo/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo manyou116/FoxBeat < /path/outside-repo/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo manyou116/FoxBeat
```

将生成的 `.pub` 内容设置为 `src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey`。密码通过 GitHub CLI 的隐藏输入填写，勿写入命令参数、提交记录或日志。现有项目已配置公钥和对应的两个 GitHub 加密 Secrets，无需重新生成。必须继续使用对应的私钥签署后续版本；丢失或直接更换私钥，会导致已安装客户端拒绝新包。

OTA 签名不是 Windows Authenticode 或 Apple Developer ID 签名。当前程序尚无这两类系统代码签名，macOS 尚未公证；首装仍可能出现系统安全提示。

## 发布新版本

1. 同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中的应用版本。
2. 执行 `npm test`、`npm run test:release`、`npm run build` 和 `cargo test --locked --manifest-path src-tauri/Cargo.toml`，提交并推送。
3. 推送匹配的 `v<版本号>` 标签。可以预先创建同标签的草稿 Release 写好更新说明，流水线会保留这些说明。
4. 等待 Windows x64、macOS Apple Silicon、macOS Intel 全部构建通过，流水线才上传附件并发布 Release。

只有版本标签构建启用 `createUpdaterArtifacts`，并要求签名私钥存在。普通本地构建、分支构建和 PR 不需要密钥。macOS 的 OTA 资产为 `.app.tar.gz`，Windows 为 NSIS `.exe`；每份 OTA 包都有 `.sig`，三平台下载地址和签名写入同一份 `latest.json`。发布准备脚本会拒绝缺少平台、缺少签名、签名版本不匹配或混入旧输出文件的情况。全部附件均写入 `SHA256SUMS`。

运行时仅接受本仓库该版本的 GitHub 下载地址；Tauri 在下载完成后验证内容签名，并核对签名绑定的版本，验证成功才安装。下载超时、网络故障、内容被修改或版本被错配都会停止更新。更新说明按普通文本显示，不执行发布内容中的代码。

## 验证边界

原生测试使用实际签名、临时本机 HTTP 服务和官方 updater，验证完整下载、进度统计、篡改拒绝及版本错配拒绝；仅测试服务允许 HTTP，生产配置要求 HTTPS。发布脚本测试覆盖 CI 归档结构、三平台清单与校验和。

首次手动安装带 OTA 的发布后，再发布一个更高版本，分别在 Windows 和两种 macOS 架构上验证应用内安装、重启和配置保留，才能确认完整实机升级。v0.1.1 及更早的客户端不包含更新器，无法靠发布新附件自动获得该功能。
