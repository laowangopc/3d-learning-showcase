# Anatomy Unified · 3D 教学观察台

面向教学的 3D 模型与 360° 全景观察平台。支持资源浏览、缩略图、标注、教师上传、管理员审核发布和账号管理。技术底座为 [Holusion/eCorpus](https://github.com/Holusion/eCorpus)；本仓库包含项目定制的前端、服务端源码、构建脚本及可公开的资源来源清单。

> 此仓库是脱敏的源码发布版，不是现有站点的数据备份。生产数据库、用户账号、上传文件、正式教学资源的 3D/全景二进制素材、私密配置及内网部署记录均未公开。资源元数据的许可不等于模型文件的许可，使用前请逐项核对来源与署名。

## 目录

- `portal/`：教学站点前端。
- `ecorpus/`：基于 eCorpus v0.3.0 的服务端与上游源码；`source/server/learning/` 是本项目的主要扩展。
- `scripts/`：构建、样例导入、资源收集及部分校验脚本。自动化下载会受上游接口、许可和速率限制影响。
- `catalog/public-catalog.json`：站点匿名目录中 2,015 条公开资源的脱敏元数据，不含站点文件地址或上传者账号；其中 46 条 `permission` 资源标注 `referenceOnly`。
- `samples/` 与 `deliverables/*/manifest.json`：来源、哈希及署名元数据；不包含正式教学模型或全景二进制。

上游 eCorpus 的 Voyager 子模块没有作为二进制或源码复制进本仓库。运行镜像使用 Dockerfile 固定的官方 eCorpus v0.3.0 镜像；从上游完整重建 Voyager 请参见其仓库。第三方许可及资源边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 本地构建和启动

需要 Node.js 22+、Docker Compose，以及可访问 GHCR 的网络。下面的 Compose 只绑定 `127.0.0.1:3080`，不是公网部署配置。

```bash
git clone https://github.com/laowangopc/anatomy-unified.git
cd anatomy-unified
export ANATOMY_RUNTIME_ROOT="${TMPDIR:-/tmp}/anatomy-unified-runtime"
npm ci
npm run prepare-local
npm run build
docker compose --env-file "$ANATOMY_RUNTIME_ROOT/.env" up -d --build
node scripts/bootstrap.mjs
```

`prepare-local` 在运行目录创建数据库密码、一次性初始化密钥和示例账号密码，不打印密码；请在该目录的 `secrets/accounts.json` 中查看并立即更换示例账号密码。初始化脚本只在空数据库创建管理员，不会重置已有账号。访问 `http://127.0.0.1:3080/learn/`。如果 `bootstrap` 失败，先检查容器健康状态并重试，不要删除数据卷。

生产部署需要独立配置 HTTPS、反向代理、最小权限、数据库与文件备份、资源授权审核及更新回退；不要把本地 Compose 直接暴露到公网。GitHub Pages 无法运行此服务的后端和数据库。

## 资源与隐私

仓库仅保留公开来源清单和必要测试夹具。2,015 条记录仅为元数据；不能把清单数量理解为随仓库提供了同等数量可再分发的文件。46 条 `permission` 记录仅供引用来源，不授予下载、复制或再分发许可。需要单独授权或权属未核实的原 Anatomy 素材、用户上传内容和内部测试证据均未纳入。导入自己的资源时，请记录来源、作者、许可、修改说明，并在公开前完成审核。

## 许可

本项目自研代码按 [Apache-2.0](LICENSE) 发布。上游 eCorpus 与其他第三方组件保留各自版权和许可；资源文件不因代码开源而获得 Apache-2.0 授权。若发现安全问题，请参见 [SECURITY.md](SECURITY.md)。
