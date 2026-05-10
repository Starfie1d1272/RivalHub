-- 将 seasons.stage_plan 中的旧 `advance` 字段转换为 `advanceTiers` 数组
-- 转换规则：advance: N → advanceTiers: [{ placement: "*", count: N }]
--
-- 部署顺序：先部署代码（代码通过 normalizeStagePlan 兼容层同时读两种格式），
-- 确认线上正常后，再跑本 migration，最后清理兼容代码。
UPDATE seasons
SET stage_plan = (
  SELECT jsonb_agg(elem_clean ORDER BY idx)
  FROM (
    SELECT
      idx,
      CASE
        WHEN elem->>'advance' IS NOT NULL THEN
          elem - 'advance' || jsonb_build_object(
            'advanceTiers', jsonb_build_array(
              jsonb_build_object('placement', '*', 'count', (elem->>'advance')::int)
            )
          )
        ELSE elem
      END AS elem_clean
    FROM jsonb_array_elements(stage_plan) WITH ORDINALITY AS t(elem, idx)
  ) sub
)
WHERE stage_plan IS NOT NULL AND jsonb_typeof(stage_plan) = 'array';
