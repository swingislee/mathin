-- 49 个模板来自同批 descriptor.create()；只在已核实的本机隔离目标执行，整个事务回滚。
-- 复用固定开发身份，不创建账号、不修改既有场景或已冻结发布。
begin;
do $test$
declare
  fixtures jsonb := $fixtures$[
{"toolId":"plane-pieces","contentVersion":"plane-pieces-lesson-v1","payload":{"title":"Shape pieces","initial":{"sceneId":"01","params":{"active":0,"rotation":0,"count":4,"reflection0":1,"angle0":0,"reflection1":1,"angle1":0,"reflection2":1,"angle2":0,"reflection3":1,"angle3":0},"points":{"piece0":{"x":160,"y":260},"piece1":{"x":320,"y":260},"piece2":{"x":480,"y":260},"piece3":{"x":640,"y":260}},"flags":{"measures":true,"grid":false,"outline":false},"marks":[],"phase":0}}},
{"toolId":"plane-pieces","contentVersion":"plane-pieces-lesson-v1","payload":{"title":"Tangram and open construction","initial":{"sceneId":"02","params":{"active":0,"rotation":0,"count":7,"reflection0":1,"angle0":0,"reflection1":1,"angle1":0,"reflection2":1,"angle2":0,"reflection3":1,"angle3":0,"reflection4":1,"angle4":0,"reflection5":1,"angle5":0,"reflection6":1,"angle6":0},"points":{"piece0":{"x":290,"y":180},"piece1":{"x":290,"y":180},"piece2":{"x":290,"y":180},"piece3":{"x":290,"y":180},"piece4":{"x":290,"y":180},"piece5":{"x":290,"y":180},"piece6":{"x":290,"y":180}},"flags":{"measures":true,"grid":false,"outline":true},"marks":[],"phase":0}}},
{"toolId":"plane-geometry","contentVersion":"plane-geometry-lesson-v1","payload":{"title":"Segments, rays and lines","initial":{"sceneId":"03","params":{},"points":{"a":{"x":240,"y":400},"b":{"x":690,"y":320},"via":{"x":480,"y":190}},"flags":{"measures":true,"grid":false,"ray":false,"fullLine":false,"detour":true},"marks":[],"phase":0}}},
{"toolId":"plane-geometry","contentVersion":"plane-geometry-lesson-v1","payload":{"title":"Angles and a movable protractor","initial":{"sceneId":"04","params":{"angle":65,"lengthA":4.5,"lengthB":4,"protractorRotation":0},"points":{"vertex":{"x":340,"y":440},"protractor":{"x":340,"y":440}},"flags":{"measures":true,"grid":false,"protractor":true},"marks":[],"phase":0}}},
{"toolId":"plane-geometry","contentVersion":"plane-geometry-lesson-v1","payload":{"title":"Parallel lines and perpendicular distance","initial":{"sceneId":"05","params":{"along":0.7},"points":{"a":{"x":220,"y":480},"b":{"x":710,"y":400},"p":{"x":410,"y":210}},"flags":{"measures":true,"grid":false,"parallel":true},"marks":[],"phase":0}}},
{"toolId":"plane-polygons","contentVersion":"plane-polygons-lesson-v1","payload":{"title":"Rods and hinged frames","initial":{"sceneId":"06","params":{"base":5,"left":3,"right":4,"opening":70},"points":{"origin":{"x":270,"y":485}},"flags":{"measures":true,"grid":false,"frame":false,"locked":true},"marks":[],"phase":0}}},
{"toolId":"plane-polygons","contentVersion":"plane-polygons-lesson-v1","payload":{"title":"Assemble the three triangle angles","initial":{"sceneId":"07","params":{},"points":{"a":{"x":240,"y":360},"b":{"x":680,"y":360},"c":{"x":410,"y":160}},"flags":{"measures":true,"grid":false},"marks":[],"phase":0}}},
{"toolId":"plane-polygons","contentVersion":"plane-polygons-lesson-v1","payload":{"title":"Quadrilateral families, bases and heights","initial":{"sceneId":"08","params":{"family":2,"width":5,"height":3,"slant":1.4,"base":0},"points":{},"flags":{"measures":true,"grid":false,"height":true},"marks":[],"phase":0}}},
{"toolId":"plane-perimeter","contentVersion":"plane-perimeter-lesson-v1","payload":{"title":"Move the boundary into a straight line","initial":{"sceneId":"10","params":{"width":4,"height":3},"points":{},"flags":{"measures":true,"grid":false},"marks":[],"phase":0}}},
{"toolId":"plane-measurement","contentVersion":"plane-measurement-lesson-v1","payload":{"title":"Tile with unit squares","initial":{"sceneId":"11","params":{"columns":4,"rows":3,"filled":0},"points":{},"flags":{"measures":true,"grid":false,"subdivision":false},"marks":[],"phase":0}}},
{"toolId":"plane-perimeter","contentVersion":"plane-perimeter-lesson-v1","payload":{"title":"Equal perimeter, different area","initial":{"sceneId":"12","params":{"width":6},"points":{},"flags":{"measures":true,"grid":false,"lockArea":false},"marks":[],"phase":0}}},
{"toolId":"plane-perimeter","contentVersion":"plane-perimeter-lesson-v1","payload":{"title":"Outer boundaries and shared seams","initial":{"sceneId":"13","params":{},"points":{"a":{"x":220,"y":310},"b":{"x":540,"y":350}},"flags":{"measures":true,"grid":false,"seams":true,"snapping":true},"marks":[],"phase":0}}},
{"toolId":"plane-geoboard","contentVersion":"plane-geoboard-lesson-v1","payload":{"title":"Geoboard area and boundary","initial":{"sceneId":"34","params":{},"points":{"v0":{"x":1,"y":1},"v1":{"x":7,"y":1},"v2":{"x":8,"y":4},"v3":{"x":5,"y":7},"v4":{"x":1,"y":5}},"flags":{"measures":true,"grid":false,"points":true,"relation":false,"units":true},"marks":[],"phase":0}}},
{"toolId":"plane-perimeter","contentVersion":"plane-perimeter-lesson-v1","payload":{"title":"Staircases, notches and perimeter","initial":{"sceneId":"43","params":{"steps":3,"notch":0},"points":{},"flags":{"measures":true,"grid":false},"marks":[],"phase":0}}},
{"toolId":"plane-geoboard","contentVersion":"plane-geoboard-lesson-v1","payload":{"title":"Lattice area: points and dissection","initial":{"sceneId":"56","params":{},"points":{"v0":{"x":1,"y":1},"v1":{"x":7,"y":1},"v2":{"x":8,"y":4},"v3":{"x":5,"y":7},"v4":{"x":1,"y":5}},"flags":{"measures":true,"grid":false,"points":true,"relation":false,"units":true},"marks":[],"phase":0}}},
{"toolId":"plane-clock","contentVersion":"plane-clock-lesson-v1","payload":{"title":"Clock hands and changing angles","initial":{"sceneId":"60","params":{"minutes":120,"start":120,"span":60},"points":{},"flags":{"measures":true,"grid":false,"ghost":true,"reflex":false},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Parallelogram dissections","initial":{"sceneId":"14","params":{"base":5,"height":3,"slant":1.5,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Two triangles make a parallelogram","initial":{"sceneId":"15","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Two trapezoids make a parallelogram","initial":{"sceneId":"16","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Split and complete composite shapes","initial":{"sceneId":"17","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Equal heights and square strips","initial":{"sceneId":"18","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-circle-area","contentVersion":"plane-circle-area-lesson-v1","payload":{"title":"Rearrange circle sectors","initial":{"sceneId":"27","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-overlap","contentVersion":"plane-overlap-lesson-v1","payload":{"title":"Overlap and regions","initial":{"sceneId":"33","params":{"base":3.5,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2,"y":1.25},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Bases and areas with equal heights","initial":{"sceneId":"37","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Triangles sharing one angle","initial":{"sceneId":"38","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"An interior point and four regions","initial":{"sceneId":"39","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Four regions of a quadrilateral","initial":{"sceneId":"40","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":1,"y":3.8},"B":{"x":4.5,"y":3.8},"C":{"x":6,"y":0},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"A shared base and a common region","initial":{"sceneId":"41","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Midpoints and nested triangles","initial":{"sceneId":"42","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-overlap","contentVersion":"plane-overlap-lesson-v1","payload":{"title":"Leaf and circular-segment regions","initial":{"sceneId":"44","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-overlap","contentVersion":"plane-overlap-lesson-v1","payload":{"title":"Circles and squares","initial":{"sceneId":"45","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Equal areas, different shapes","initial":{"sceneId":"46","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.3333333333333333,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area","contentVersion":"plane-area-lesson-v1","payload":{"title":"Four congruent right triangles","initial":{"sceneId":"58","params":{"base":3,"height":4,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.55,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-area-relations","contentVersion":"plane-area-relations-lesson-v1","payload":{"title":"Hourglass and nested triangles","initial":{"sceneId":"59","params":{"base":6,"height":3.5,"slant":1.8,"top":3,"fraction":0.45,"secondary":0.45,"count":16,"layers":2,"radius":2.3,"cuts":0,"angle":0},"points":{"A":{"x":0,"y":0},"B":{"x":6,"y":0},"C":{"x":1.8,"y":3.5},"P":{"x":2.7,"y":1.5},"D":{"x":0,"y":0}},"flags":{"grid":false,"measures":true,"constraint":true,"original":true,"areas":false,"strips":false,"complement":false,"alternate":false,"snap":true,"intersection":true},"marks":[],"phase":0}}},
{"toolId":"plane-motion","contentVersion":"plane-motion-lesson-v1","payload":{"title":"Translation and corresponding points","initial":{"sceneId":"20","params":{"dx":210,"dy":-40},"points":{},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-motion","contentVersion":"plane-motion-lesson-v1","payload":{"title":"Center and angle of rotation","initial":{"sceneId":"21","params":{"angle":90},"points":{"center":{"x":460,"y":365}},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-motion","contentVersion":"plane-motion-lesson-v1","payload":{"title":"Reflection and folding","initial":{"sceneId":"22","params":{"axisAngle":90},"points":{},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-motion","contentVersion":"plane-motion-lesson-v1","payload":{"title":"Repeated motifs","initial":{"sceneId":"24","params":{"copies":6},"points":{"center":{"x":460,"y":350}},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-folding","contentVersion":"plane-folding-lesson-v1","payload":{"title":"Fold and cut paper","initial":{"sceneId":"32","params":{"radius":22},"points":{"center":{"x":460,"y":350},"hole":{"x":390,"y":280}},"flags":{"grid":false,"measures":true,"twice":true,"cut":false,"traces":true},"marks":[],"phase":0}}},
{"toolId":"plane-tiling","contentVersion":"plane-tiling-lesson-v1","payload":{"title":"Tiling and gaps","initial":{"sceneId":"36","params":{"count":1,"sides":3,"selected":0,"angle":0},"points":{"tile0":{"x":430,"y":345}},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-reflection-path","contentVersion":"plane-reflection-path-lesson-v1","payload":{"title":"Reflection and broken-line routes","initial":{"sceneId":"54","params":{"axisAngle":0,"contact":-70},"points":{"center":{"x":450,"y":440},"a":{"x":260,"y":235},"b":{"x":660,"y":185}},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-rolling","contentVersion":"plane-rolling-lesson-v1","payload":{"title":"A circle rolling inside or outside another","initial":{"sceneId":"55","params":{"largeRadius":140,"smallRadius":45,"orbit":360},"points":{"center":{"x":450,"y":355}},"flags":{"grid":true,"measures":true,"origin":true,"traces":true,"snap":true},"marks":[],"phase":0}}},
{"toolId":"plane-patterns","contentVersion":"plane-patterns-lesson-v1","payload":{"title":"Whole segments and angles","initial":{"sceneId":"47","params":{"numberStep":-1,"selected":0,"angle":0},"points":{},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-patterns","contentVersion":"plane-patterns-lesson-v1","payload":{"title":"Triangles by size and orientation","initial":{"sceneId":"48","params":{"levels":3},"points":{},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-patterns","contentVersion":"plane-patterns-lesson-v1","payload":{"title":"Squares and rectangles in a grid","initial":{"sceneId":"49","params":{"columns":4,"rows":3},"points":{},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-matchsticks","contentVersion":"plane-matchsticks-lesson-v1","payload":{"title":"Matchsticks and shared sides","initial":{"sceneId":"51","params":{"numberStep":-1,"selected":0,"angle":0,"count":10,"angle0":0,"angle1":0,"angle2":0,"angle3":-90,"angle4":0,"angle5":-90,"angle6":0,"angle7":-90,"angle8":0,"angle9":-90},"points":{"match0":{"x":330,"y":420},"match1":{"x":430,"y":420},"match2":{"x":530,"y":420},"match3":{"x":280,"y":370},"match4":{"x":330,"y":320},"match5":{"x":380,"y":370},"match6":{"x":430,"y":320},"match7":{"x":480,"y":370},"match8":{"x":530,"y":320},"match9":{"x":580,"y":370}},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-graph-path","contentVersion":"plane-graph-path-lesson-v1","payload":{"title":"One-stroke and multi-stroke paths","initial":{"sceneId":"52","params":{"numberStep":-1,"selected":0,"angle":0},"points":{},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-grid-path","contentVersion":"plane-grid-path-lesson-v1","payload":{"title":"Grid routes and step-by-step counts","initial":{"sceneId":"53","params":{"columns":4,"rows":3,"numberStep":-1},"points":{},"flags":{"grid":false,"measures":false,"origin":true,"highlights":true,"snap":true},"marks":[],"phase":1}}},
{"toolId":"plane-covering","contentVersion":"plane-covering-lesson-v1","payload":{"title":"Checkerboard coloring and dominoes","initial":{"sceneId":"57","params":{"count":1,"selected":0},"points":{"domino0":{"x":1,"y":2}},"flags":{"grid":false,"coloring":true,"counts":false,"vertical":false,"removeCells":false},"marks":[],"phase":1}}}
]$fixtures$::jsonb;
  s jsonb; bad jsonb; sample jsonb; item jsonb; initial jsonb; legacy jsonb;
  doc jsonb := '{"docVersion":"courseware-composition-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff"},"source":null,"overlay":{"docVersion":"page-doc-v1","canvas":{"width":960,"height":720,"backgroundColor":"#ffffff","backgroundBindingKey":null},"nodes":[],"interactions":[]},"layout":{"version":"courseware-composition-grid-v1","columns":12,"rows":9,"blocks":[]}}';
  frozen jsonb; seen text[] := array[]::text[]; key text; proc record;
  owner_id uuid; other_id uuid; draft_id uuid; first_draft_id uuid; first_scene jsonb; saved public.tool_scene_drafts;
begin
  if jsonb_array_length(fixtures)<>49 or (select count(distinct value->>'toolId') from jsonb_array_elements(fixtures))<>21
    then raise exception 'PLANAR_FIXTURE_COVERAGE'; end if;
  for s in select value from jsonb_array_elements(fixtures) loop
    if public.tool_planar_scene_is_valid(s) is not true or public.tool_scene_is_valid(s) is not true
      or public.tool_scene_catalog_id(s) is distinct from s->>'toolId'
      then raise exception 'PLANAR_TEMPLATE_REJECTED: %',s#>>'{payload,initial,sceneId}'; end if;
    foreach key in array array['sceneId','params','points','flags','marks','phase'] loop
      if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial}',(s#>'{payload,initial}')-key)) is not false
        then raise exception 'PLANAR_MISSING_STATE_KEY: % %',s#>>'{payload,initial,sceneId}',key; end if;
    end loop;
    foreach bad in array array[
      s-'payload',s||'{"draftId":"private"}',jsonb_set(s,'{contentVersion}','"future-v9"'),
      jsonb_set(s,'{payload,title}','null'),jsonb_set(s,'{payload,title}','""'),
      jsonb_set(s,'{payload,initial,phase}','-0.1'),jsonb_set(s,'{payload,initial,phase}','1.1'),
      jsonb_set(s,'{payload,initial,phase}','"0"'),jsonb_set(s,'{payload,initial,flags,grid}','"false"'),
      jsonb_set(s,'{payload,initial,flags,__proto__}','true'),jsonb_set(s,'{payload,initial,params,constructor}','1'),
      jsonb_set(s,'{payload,initial,marks}','["prototype"]'),
      jsonb_set(s,'{payload,initial,params}','[]'),jsonb_set(s,'{payload,initial,marks}','[1]'),
      jsonb_set(s,'{payload,initial,points,polluted}','{"x":1,"y":2,"z":3}'),
      jsonb_set(s,'{payload,initial,points,polluted}','{"x":100001,"y":2}'),
      jsonb_set(s,'{payload,initial,points,polluted}','{"x":"1","y":2}'),
      jsonb_set(s,'{payload,initial,past}','[]')
    ] loop
      if public.tool_scene_is_valid(bad) is not false then raise exception 'PLANAR_BAD_SHAPE_ACCEPTED: %',s#>>'{payload,initial,sceneId}'; end if;
    end loop;
    doc := jsonb_set(doc,'{layout,blocks}',jsonb_build_array(jsonb_build_object('id','planar-fixed','type','tool','tool',s,
      'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9))));
    if public.cw_courseware_composition_doc_is_valid(doc) is not true or public.cw_manual_composition_doc_is_valid(doc) is not true
      or public.cw_formal_cube_page_is_valid(doc) is not true then raise exception 'PLANAR_COURSEWARE_REJECTED: %',s->>'toolId'; end if;
  end loop;
  s:=fixtures->0;
  foreach bad in array array[
    jsonb_set(s,'{toolId}','"plane-geometry"'),jsonb_set(s,'{payload,initial,sceneId}','"03"'),
    jsonb_set(s,'{payload,initial,sceneId}','"09"'),jsonb_set(s,'{payload,initial,params,count}','21'),
    jsonb_set(s,'{payload,initial,params,count}','1.5'),jsonb_set(s,'{payload,initial,params,active}','999'),
    jsonb_set(s,'{payload,initial,points}',(s#>'{payload,initial,points}')-'piece0'),
    jsonb_set(s,'{payload,initial,params}',(s#>'{payload,initial,params}')-'reflection0'),
    jsonb_set(s,'{payload,initial,marks}',(select jsonb_agg('m'||n) from generate_series(1,513) n)),
    jsonb_set(s,'{payload,initial,flags}',(select jsonb_object_agg('f'||n,true) from generate_series(1,257) n)),
    jsonb_set(s,'{payload,title}',to_jsonb(repeat('x',150001)))
  ] loop if public.tool_scene_is_valid(bad) is not false then raise exception 'PLANAR_BOUNDS_OR_OWNERSHIP_ACCEPTED'; end if; end loop;

  -- 数学域边界与动态对象上限，而不只是 JSON 外壳。
  for s in select value from jsonb_array_elements(fixtures) loop
    bad:=case s#>>'{payload,initial,sceneId}'
      when '04' then jsonb_set(s,'{payload,initial,params,angle}','181')
      when '05' then jsonb_set(s,'{payload,initial,points,b}',s#>'{payload,initial,points,a}')
      when '06' then jsonb_set(s,'{payload,initial,params,left}','0')
      when '07' then jsonb_set(s,'{payload,initial,points,c}',s#>'{payload,initial,points,a}')
      when '08' then jsonb_set(s,'{payload,initial,params,family}','5')
      when '11' then jsonb_set(s,'{payload,initial,params,filled}','101')
      when '14' then jsonb_set(s,'{payload,initial,params,cuts}','2')
      when '18' then jsonb_set(s,'{payload,initial,points,C}',s#>'{payload,initial,points,A}')
      when '21' then jsonb_set(s,'{payload,initial,points}','{}')
      when '24' then jsonb_set(s,'{payload,initial,params,copies}','13')
      when '27' then jsonb_set(s,'{payload,initial,params,count}','9')
      when '32' then jsonb_set(s,'{payload,initial,points,hole}',s#>'{payload,initial,points,center}')
      when '33' then jsonb_set(s,'{payload,initial,points}',(s#>'{payload,initial,points}')-'P')
      when '34' then jsonb_set(s,'{payload,initial,points,v0,x}','1.5')
      when '36' then jsonb_set(s,'{payload,initial,params,count}','25')
      when '40' then jsonb_set(s,'{payload,initial,points,D}',s#>'{payload,initial,points,B}')
      when '43' then jsonb_set(s,'{payload,initial,params,steps}','8.5')
      when '47' then jsonb_set(s,'{payload,initial,marks}','["figure.A.Z"]')
      when '48' then jsonb_set(s,'{payload,initial,params,levels}','100000')
      when '49' then jsonb_set(s,'{payload,initial,params,columns}','100000')
      when '51' then jsonb_set(s,'{payload,initial,params,count}','49')
      when '52' then jsonb_set(s,'{payload,initial,marks}','["stroke.A.E"]')
      when '53' then jsonb_set(s,'{payload,initial,params,numberStep}','1000')
      when '54' then jsonb_set(s,'{payload,initial,params,contact}','3001')
      when '55' then jsonb_set(s,'{payload,initial,params,smallRadius}','200')
      when '56' then jsonb_set(s,'{payload,initial,points,v0}',s#>'{payload,initial,points,v3}')
      when '57' then jsonb_set(s,'{payload,initial,marks}','["missing.1_2"]')
      when '60' then jsonb_set(s,'{payload,initial,params,minutes}','1441')
      else null end;
    if bad is not null and public.tool_scene_is_valid(bad) is not false then raise exception 'PLANAR_DOMAIN_INVALID_ACCEPTED: %',s#>>'{payload,initial,sceneId}'; end if;
  end loop;
  select value into s from jsonb_array_elements(fixtures) where value#>>'{payload,initial,sceneId}'='47';
  sample:=jsonb_set(s,'{payload,initial,marks}','["figure.A.F"]');
  if public.tool_scene_is_valid(sample) is not true
    or public.tool_scene_is_valid(jsonb_set(sample,'{payload,initial,marks}','["figure.A.F","closed.C.D"]')) is not false
    then raise exception 'PLANAR_SEGMENT_COVERAGE'; end if;
  select value into s from jsonb_array_elements(fixtures) where value#>>'{payload,initial,sceneId}'='48';
  if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial,marks}','["figure.0_0.0_3.3_3"]')) is not true
    then raise exception 'PLANAR_TRIANGLE_COMPOSITE_EDGES'; end if;
  select value into s from jsonb_array_elements(fixtures) where value#>>'{payload,initial,sceneId}'='52';
  if public.tool_scene_is_valid(jsonb_set(s,'{payload,initial,marks}','["stroke.A.B.C.E.D.A"]')) is not true
    then raise exception 'PLANAR_PATH_CONTINUITY'; end if;
  select value into s from jsonb_array_elements(fixtures) where value#>>'{payload,initial,sceneId}'='57';
  bad:=jsonb_set(jsonb_set(jsonb_set(s,'{payload,initial,params,count}','2'),'{payload,initial,points,domino1}',s#>'{payload,initial,points,domino0}'),'{payload,initial,flags,vertical1}','false');
  if public.tool_scene_is_valid(bad) is not false then raise exception 'PLANAR_DOMINO_OVERLAP'; end if;

  legacy:='{"toolId":"fraction-line","contentVersion":"fraction-line-lesson-v1","payload":{"title":"Legacy fraction","initial":{"rows":[{"denominator":3,"count":5,"color":"var(--rose)"}],"denomText":"3","zoomPow":2,"showTicks":true,"showGuides":true,"zeroX":56}}}';
  if public.tool_scene_is_valid(legacy) is not true or public.tool_scene_catalog_id(legacy)<>'fraction-line'
    then raise exception 'PLANAR_LEGACY_VERSION_REGRESSION'; end if;
  if has_table_privilege('anon','public.tool_scene_drafts','select')
    or has_function_privilege('anon','public.save_tool_scene_draft(uuid,jsonb,integer)','execute')
    or has_function_privilege('authenticated','public.tool_scene_is_valid(jsonb)','execute')
    then raise exception 'PLANAR_PRIVILEGE_REGRESSION'; end if;
  for proc in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tool_planar_%' loop
    if has_function_privilege('anon',proc.oid,'execute') or has_function_privilege('authenticated',proc.oid,'execute')
      or has_function_privilege('service_role',proc.oid,'execute') then raise exception 'PLANAR_VALIDATOR_EXPOSED'; end if;
  end loop;

  select id into owner_id from public.profiles where display_name='测试-教师' and is_active limit 1;
  select id into other_id from public.profiles where display_name='测试-教研' and is_active limit 1;
  if owner_id is null or other_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  -- 每个目录都经原保存 RPC 往返一次；回滚事务结束后没有测试草稿残留。
  for s in select value from jsonb_array_elements(fixtures) loop
    if s->>'toolId'=any(seen) then continue; end if;
    seen:=array_append(seen,s->>'toolId'); draft_id:=gen_random_uuid();
    saved:=public.save_tool_scene_draft(draft_id,s,0);
    if saved.catalog_id<>s->>'toolId' or saved.scene<>s or saved.revision<>1
      or (select scene from public.tool_scene_drafts where id=draft_id) is distinct from s
      then raise exception 'PLANAR_DRAFT_ROUNDTRIP: %',s->>'toolId'; end if;
    if first_draft_id is null then first_draft_id:=draft_id; first_scene:=s; end if;
  end loop;
  frozen:=jsonb_build_object('id','planar-fixed-copy','type','tool','tool',first_scene,'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9));
  saved:=public.save_tool_scene_draft(first_draft_id,jsonb_set(first_scene,'{payload,title}','"Later preparation"'),1);
  if saved.revision<>2 or frozen->'tool' is distinct from first_scene then raise exception 'PLANAR_FIXED_COPY_CHANGED'; end if;
  begin perform public.save_tool_scene_draft(first_draft_id,first_scene,1); raise exception 'PLANAR_STALE_WRITE_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'TOOL_DRAFT_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  if (select count(*) from public.tool_scene_drafts where id=first_draft_id)<>0 then raise exception 'PLANAR_OTHER_OWNER_READ'; end if;
  begin perform public.save_tool_scene_draft(first_draft_id,first_scene,2); raise exception 'PLANAR_OTHER_OWNER_WRITE';
  exception when sqlstate 'P0002' then null; end;
  begin update public.tool_scene_drafts set name='Direct write' where id=first_draft_id; raise exception 'PLANAR_DIRECT_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select scene#>>'{payload,title}' from public.tool_scene_drafts where id=first_draft_id)<>'Later preparation'
    then raise exception 'PLANAR_FAILED_WRITE_CHANGED_DRAFT'; end if;
end;
$test$;
rollback;
