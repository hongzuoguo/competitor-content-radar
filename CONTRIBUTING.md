# Contributing to HitMuse

感谢贡献。请在公开源码工作区完成开发和验证；不要提交凭证、用户数据、生成的二进制文件或模型文件。

## 开发环境

需要 Windows 10/11 x64、Node.js 24、npm 11.12.1，以及 Python 3.12。推荐先执行 `npm ci`，再执行 `npm run setup:scrapling-dev`：这个命令会清空并重新创建 `engine\scrapling\.venv`，以便从锁定依赖得到确定的 Scrapling 开发环境。

在全新工作区中，下面是与推荐流程对应的精确手动启动序列。若 `.venv` 已存在，请使用上面的推荐命令，不要把手动安装当作替代的增量修复方式。

```powershell
py -3.12 -m venv engine\scrapling\.venv
engine\scrapling\.venv\Scripts\python.exe -m pip install --require-hashes -r engine\scrapling\requirements.lock.txt
npm ci
npm run dev
```

常用验证：

```powershell
npm test
npm run typecheck
engine\scrapling\.venv\Scripts\python.exe -m unittest discover -s engine/scrapling/tests
```

## 提交与 PR

- 从当前公开默认分支创建主题分支；提交前保持工作树干净，并让每个提交聚焦一个可审阅的改动。
- 不要把 App Secret、API Key、Token、Cookie、登录会话、数据库、日志、生成的 Scrapling ZIP、模型、安装包或其他生成二进制文件加入 Git。
- PR 请说明目的、测试命令和结果；涉及 UI 时附经过脱敏处理的截图或说明。
- 不要依赖个人目录、未跟踪资源、非公开资源、手工复制的构建产物或跨仓库发布。资源必须来自本仓库记录的公开来源和校验信息。

## 发布边界

贡献者不手工上传安装包，也不使用 `gh` 或个人令牌发布。发布者为已验证提交创建 `v<package.version>` Tag；同一仓库的发布工作流在所有门禁通过后创建 Release。`npm run release:local` 仅作本地正式验证，does not publish。
