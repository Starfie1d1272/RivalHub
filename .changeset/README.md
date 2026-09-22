# Changesets

本目录只负责记录“某个变更将如何进入后续版本说明”。完整 release procedure 只由 [`docs/operations/release.md`](../docs/operations/release.md) 维护。

## 什么时候写

以下变更通常应在对应 feature PR 中提交 Changeset：

- 用户或管理员可感知的 `feat` / `fix` / `refactor`；
- production runtime、权限、安全边界或 data contract 变化；
- schema / migration；
- production dependency 的安全或兼容升级。

纯文档、纯测试、CI / 本地开发工具，以及不改变 shipped behavior 的维护通常不需要；PR 中说明原因即可。

## 怎么写

运行：

```bash
pnpm changeset
```

摘要默认使用中文，保留必要代码名、字段名、协议名和库名。内容描述用户、管理员或运营者能观察到的变化，不复制 commit message 或内部实现步骤。

不要手改 `package.json` version。

## 发版时

Release branch 只消费已经随日常 PR 进入 `main` 的 Changesets：

```bash
pnpm exec changeset version
```

版本号、CHANGELOG review、compare 链接、release PR、tag、production deploy 和 GitHub Release 的顺序全部以 [`docs/operations/release.md`](../docs/operations/release.md) 为准；本文件不建立第二套发布流程。
