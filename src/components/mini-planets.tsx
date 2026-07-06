import type { Planet } from "./section-shell";

/**
 * 迷你星球（docs/plan/05-§4）：24px 内、accent 30% 罩染 + 陨石棕描边 + 一个
 * 「凑近才认出」的特征细节。外层 data-planet 使 --p-* 在任何页面可解析。
 */
export function MiniPlanet({ planet }: { planet: Planet }) {
  return (
    <span data-planet={planet} className="grid place-items-center">
      <svg width={26} height={26} viewBox="0 0 24 24" aria-hidden>
        <circle cx={12} cy={12} r={9.25} fill="var(--p-accent)" fillOpacity={0.3} stroke="var(--crater)" strokeWidth={1.5} />
        {planet === "earth" && (
          /* 一道沙丘弧线 */
          <path d="M4.8 14.6 C 7.4 12.9 9.8 12.9 12 14.6 C 14.2 16.3 16.6 16.3 19.2 14.6" fill="none" stroke="var(--p-accent)" strokeWidth={1.4} strokeLinecap="round" />
        )}
        {planet === "king" && (
          /* 顶上一枚小王冠 */
          <path d="M8.6 5.4 L9.7 3.2 L11 4.8 L12 2.6 L13 4.8 L14.3 3.2 L15.4 5.4 Z" fill="var(--p-accent-2)" stroke="var(--crater)" strokeWidth={0.9} strokeLinejoin="round" />
        )}
        {planet === "lamplighter" && (
          /* 一点灯焰 */
          <>
            <circle cx={15.8} cy={7.6} r={3.4} fill="var(--p-accent)" fillOpacity={0.3} />
            <circle cx={15.8} cy={7.6} r={1.7} fill="var(--p-accent)" />
          </>
        )}
        {planet === "geographer" && (
          /* 一圈经线弧 */
          <path d="M12 2.9 C 16.6 6.2 16.6 17.8 12 21.1" fill="none" stroke="var(--p-accent-2)" strokeWidth={1.2} strokeLinecap="round" />
        )}
        {planet === "businessman" && (
          /* 三粒金算珠 */
          <g fill="var(--p-accent)" stroke="var(--crater)" strokeWidth={0.7}>
            <circle cx={7.8} cy={12} r={1.5} />
            <circle cx={12} cy={12} r={1.5} />
            <circle cx={16.2} cy={12} r={1.5} />
          </g>
        )}
      </svg>
    </span>
  );
}
