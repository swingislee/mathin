-- 只调用纯校验函数；样例不写入业务表。
do $$
declare
  stroke jsonb := '{"id":"11111111-1111-4111-8111-111111111111","mode":"ink","color":"ink","wNorm":0.003,"points":[[0.1,0.2],[0.3,0.4]]}';
  shape jsonb := '{"id":"11111111-1111-4111-8111-111111111112","kind":"shape","shape":"rectangle","color":"blue","fill":null,"strokeWidthNorm":0.003,"x":0.5,"y":0.5,"width":0.3,"height":0.2,"rotation":0}';
  color text;
  brush text;
  candidate jsonb;
  patch jsonb;
  rejected boolean;
begin
  foreach color in array array['ink','rose','blue','leaf','crater','cheek','moon','#000000','#ffffff','#A0b1C2']
  loop
    candidate := jsonb_build_array(stroke || jsonb_build_object('color',color), shape || jsonb_build_object('color',color,'fill',color));
    if public.validate_courseware_annotation_content(candidate) is distinct from candidate then raise exception 'COLOR_ROUNDTRIP'; end if;
  end loop;
  foreach brush in array array['round-v1','freehand-v1','freehand-v2','freehand-v3']
  loop
    candidate := jsonb_build_array(stroke || jsonb_build_object('color','#aabbcc','brush',brush,'samples','[[0,null],[16,0.8]]'::jsonb),shape);
    if public.validate_courseware_annotation_content(candidate) is distinct from candidate then raise exception 'PRESSURE_ROUNDTRIP'; end if;
  end loop;
  foreach color in array array['#000','#12345g','#12345678',E'#123456\n','red','rgb(1,2,3)','url(https://example.com)','var(--ink)','']
  loop
    for candidate in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_array(stroke || jsonb_build_object('color',color)),
      jsonb_build_array(shape || jsonb_build_object('color',color)),
      jsonb_build_array(shape || jsonb_build_object('fill',color))))
    loop
      rejected := false;
      begin perform public.validate_courseware_annotation_content(candidate);
      exception when raise_exception then if sqlerrm <> 'VALIDATION' then raise; end if; rejected := true;
      end;
      if not rejected then raise exception 'INVALID_COLOR_ACCEPTED: %',color; end if;
    end loop;
  end loop;
  for patch in select value from jsonb_array_elements('[
    {"color":null},{"color":123},{"color":{}},{"brush":"freehand-v99"},{"brush":null},
    {"samples":null},{"samples":[]},{"samples":[[0,0.3]]},{"samples":[[1,0.3],[0,0.4]]},
    {"samples":[[-1,0.3],[1,0.4]]},{"samples":[[0,2],[1,0.4]]},{"samples":[[0,0.3],[1,"bad"]]},
    {"samples":[[null,0.3],[1,0.4]]},{"samples":[[0],[1]]},{"samples":[0,1]},
    {"points":[[-0.1,0.2],[0.3,0.4]]},{"wNorm":0},{"unexpected":true}
  ]'::jsonb)
  loop
    rejected := false;
    begin perform public.validate_courseware_annotation_content(jsonb_build_array(stroke || patch));
    exception when raise_exception then if sqlerrm <> 'VALIDATION' then raise; end if; rejected := true;
    end;
    if not rejected then raise exception 'INVALID_STROKE_ACCEPTED: %',patch; end if;
  end loop;
  if has_function_privilege('anon','public.validate_courseware_annotation_content(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.validate_courseware_annotation_content(jsonb)','EXECUTE') then
    raise exception 'VALIDATOR_MUST_REMAIN_INTERNAL';
  end if;
end;
$$;

select jsonb_build_object('colors','PASS','pressureMetadata','PASS','invalidInputs','PASS','internalPermissions','PASS');
