// CS2 单图玩家数据合法范围 [min, max | null]
// null 表示无上限（只检查非负），仅对数学上有硬边界的字段设置上限。
const STAT_RANGES: Record<string, readonly [number, number | null]> = {
  // 计数类：只需非负，不设上限（OT 场次可以很高）
  kills:      [0, null],
  deaths:     [0, null],
  assists:    [0, null],
  firstKills: [0, null],
  multiKills: [0, null],
  clutches:   [0, null],
  // 百分比：数学硬边界 0-100
  hsPercent:  [0, 100],
  rws:        [0, 100],
  // 均值类：设宽松上限，主要挡 OCR 错位
  adr:        [0, 300],   // 伤害/局理论最大 ~300
  ratingPro:  [0.01, 5.0], // HLTV 式评分，极端单图可达 3-4，> 5 必是错误
};

export function isStatOutOfRange(key: string, value: number | null): boolean {
  if (value === null) return false;
  const range = STAT_RANGES[key];
  if (!range) return false;
  if (value < range[0]) return true;
  if (range[1] !== null && value > range[1]) return true;
  return false;
}
