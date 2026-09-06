import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardCommandTabs, DashboardPage } from './dashboard-page';
import { BusinessHistorySections } from './BusinessHistorySections';
import { loadStudentBusinessHistory } from './student-business-history-data';
import { getStudentBusinessHistoryMessages } from './student-business-history-messages';

export async function BusinessHistoryWorkspace({locale,kind,query=''}:{locale:string;kind:'renewal'|'activity';query?:string}) {
  const m=getStudentBusinessHistoryMessages(locale);
  const base=kind==='renewal'?'/dashboard/followups/renewals':'/dashboard/activities';
  const data=await loadStudentBusinessHistory(locale,{kind});
  if(!data)return <p className="text-sm text-muted">{m.denied}</p>;
  return <DashboardPage title={m[kind]} description={m.intro} commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><DashboardCommandTabs items={[
      {value:'current',label:kind==='renewal'?m.currentRenewals:m.currentActivities,href:base},
      {value:'history',label:m[kind],href:`${base}?view=history`},
    ]} activeValue="history" ariaLabel={m.title}/></DashboardCommandState>
    <DashboardCommandFilters><form className="flex min-w-0 flex-wrap items-center gap-2" method="get">
      <Input type="hidden" name="view" value="history" readOnly/>
      <Input name="q" defaultValue={query} placeholder={m.search} aria-label={m.search} className="w-60"/>
      <Button type="submit" variant="secondary" size="sm">{m.searchButton}</Button>
    </form></DashboardCommandFilters>
    <DashboardCommandActions>{query&&<Link href={`${base}?view=history`} className={buttonVariants({variant:'ghost',size:'sm'})}>{m.clear}</Link>}</DashboardCommandActions>
  </DashboardCommandPanel>}>
    <BusinessHistorySections data={data} locale={locale} kind={kind} showStudent query={query}/>
  </DashboardPage>;
}
