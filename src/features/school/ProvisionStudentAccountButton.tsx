"use client";
import{useState}from"react";import{LoaderCircle,Smartphone}from"lucide-react";import{useTranslations}from"next-intl";import{Button}from"@/components/ui/button";import{ConfirmDialog}from"@/components/ui/confirm-dialog";import{useAction}from"@/components/action-form";import{useRouter}from"@/i18n/navigation";import{provisionStudentPhoneAccountAction}from"./actions/students";

export function ProvisionStudentAccountButton({studentId,phone}:{studentId:string;phone:string}){
  const t=useTranslations("school.students");
  const router=useRouter();
  const[open,setOpen]=useState(false);
  const{run,pending}=useAction(provisionStudentPhoneAccountAction,{
    successMessage:t("provisionPhoneSuccess"),
    errorMessage:{ACCOUNT_ALREADY_LINKED:t("provisionPhoneAlreadyLinked"),INVALID_PHONE:t("provisionPhoneInvalid"),default:t("provisionPhoneFailed")},
    onSuccess:()=>router.refresh(),
  });
  return <span className="inline-flex flex-col items-end gap-1">
    <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={()=>setOpen(true)}>
      {pending?<LoaderCircle size={14} className="animate-spin"/>:<Smartphone size={14}/>} {t("provisionPhoneAccount")}
    </Button>
    <ConfirmDialog open={open} onOpenChange={setOpen} title={t("provisionPhoneTitle")} description={t("provisionPhoneConfirm",{phone:phone||t("none")})} confirmLabel={t("provisionPhoneAccount")} cancelLabel={t("cancel")} pending={pending} onConfirm={()=>{setOpen(false);run(studentId);}}/>
  </span>;
}
