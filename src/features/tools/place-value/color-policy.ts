/** 视觉计数固定五个一组，与数学进制和数位容量分别计算。 */
export const PLACE_VALUE_COLOR_GROUP_SIZE = 5;
export const PLACE_VALUE_COLOR_PERIOD = PLACE_VALUE_COLOR_GROUP_SIZE * 2;
export const placeValueColorPhase = (index: number) => index % PLACE_VALUE_COLOR_PERIOD;
export const placeValueIsBlue = (index: number) => placeValueColorPhase(index) >= PLACE_VALUE_COLOR_GROUP_SIZE;
