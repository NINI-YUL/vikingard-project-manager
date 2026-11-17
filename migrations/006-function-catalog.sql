ALTER TABLE source_bindings ADD COLUMN function_options jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE work_items ADD COLUMN function_resolution text NOT NULL DEFAULT 'missing' CHECK (function_resolution IN ('confirmed','legacy_unresolved','unrecognized','missing'));
UPDATE work_items SET function_resolution=CASE
  WHEN function_name IS NULL OR btrim(function_name)='' THEN 'missing'
  WHEN function_name IN ('UI界面','UI图标','美术','动效','数值','客户端','服务端','KGUI','后台') THEN 'confirmed'
  WHEN function_name='UI' THEN 'legacy_unresolved'
  ELSE 'unrecognized' END;
UPDATE work_items SET structure_issues=structure_issues || CASE WHEN function_name='UI' THEN '["legacy_function_unresolved"]'::jsonb ELSE '["unknown_function_value"]'::jsonb END
WHERE function_name IS NOT NULL AND function_name NOT IN ('UI界面','UI图标','美术','动效','数值','客户端','服务端','KGUI','后台')
  AND NOT (structure_issues @> CASE WHEN function_name='UI' THEN '["legacy_function_unresolved"]'::jsonb ELSE '["unknown_function_value"]'::jsonb END);
