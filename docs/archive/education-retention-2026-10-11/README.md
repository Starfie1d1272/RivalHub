# 教育到期材料界面核验

1440、390、320 px 截图使用真实 EducationVerificationReviewQueue、Panel、EmptyState 和应用样式，在隔离 Vite fixture 中渲染已通过 CHSI 与已驳回录取材料的到期 DTO。全部身份为合成数据，action 禁用；不是生产登录/Storage 验收。

Playwright 确認无 page error、无横向溢出、无“查看材料”链接；人工复核桌面及 320 px 两类到期提示与审核结论。后端边界分别由签名访问单测与真实 PostgreSQL admin-review/retention 集成测试覆盖。

- [桌面 1440](1440-expired.png)
- [窄屏 390](390-expired.png)
- [窄屏 320](320-expired.png)
