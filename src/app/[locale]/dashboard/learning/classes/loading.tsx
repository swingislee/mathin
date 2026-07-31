import { DashboardCard, DashboardContentGrid, DashboardMainColumn, DashboardPage } from "@/features/school/dashboard-page";

export default function LearningClassesLoading() {
  return (
    <DashboardPage title="…">
      <DashboardContentGrid>
        <DashboardMainColumn>
          <DashboardCard className="h-40 animate-pulse bg-line/25" />
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}