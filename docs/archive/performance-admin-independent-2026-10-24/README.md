# 后台独立读取与历史窗口

prestart的recent roster change只消费每队倒数第二个有approvedAt的revision。新SQL window按entryId分区、revisionNumber降序，直接返回position=2；之后仍按同一revision读取成员并执行原差异投影，不按current pointer、status或frozen来源改写历史。数据库仍可能扫描/排序历史，不宣称扫描O(1)。真实PG同一100条approvedAt历史：返回100→1行，ID与原升序数组倒数第二个一致；空入口集合/仅一条/较新无approvedAt记录不产生错误前驱。原prestart选择/冻结/回滚7例通过。

后台draft pool读取原先state→teams→members→picks串行，现在state、teams、picks并行，members仍依赖teams；remaining count仍依赖canonical picked/captain集合。公开RR/Tx和captain默认路径保留原顺序。三个后台catalog pool consumer显式使用已有concurrent开关，Tx/freeze调用保持默认顺序，没有新增catalog规则。

隔离真实PG注入每条SELECT的pg_sleep(25ms)以观察issued/settled重叠：draft5→5SQL，最大in-flight1→3，单次117.668→67.279ms；catalog3→3SQL，最大1→3，80.229→27.562ms。前后DTO完全相等，draft非空state/两team/一pick，remaining count3。是受控延迟实验，不是生产查询计划、池饱和或p95收益承诺。无实际延迟时不声称相同倍数改善。测试不改变生产SQL，只在隔离test wrapper中加入延迟。

app/tests类型、文件级ESLint、architecture通过。复现：定向运行tests/integration/db/admin-independent-reads.test.ts与major-prestart-selection.test.ts。所有fixture写入和append-only清理仅在隔离本地数据库；生产无写入。
