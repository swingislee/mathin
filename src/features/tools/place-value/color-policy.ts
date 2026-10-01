/** 视觉计数固定五个一组，与数学进制和数位容量分别计算。 */
export const PLACE_VALUE_COLOR_GROUP_SIZE = 5;
export const PLACE_VALUE_COLOR_PERIOD = PLACE_VALUE_COLOR_GROUP_SIZE * 2;
/** 选中只提亮原色，保持黄蓝计数与待进位红色的辨识。 */
export const PLACE_VALUE_SELECTION_LIGHT = "#ffffff";
export const PLACE_VALUE_SELECTION_LIGHTENING = .18;
export const placeValueColorPhase = (index: number) => index % PLACE_VALUE_COLOR_PERIOD;
export const placeValueIsBlue = (index: number) => placeValueColorPhase(index) >= PLACE_VALUE_COLOR_GROUP_SIZE;
