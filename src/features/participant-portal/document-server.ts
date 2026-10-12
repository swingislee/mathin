import "server-only";
import { policies } from "@/features/parent-portal/onboarding-server";
import { PortalError, response } from "@/features/parent-portal/server";

export async function miniappDocumentGet(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id !== "privacy" && id !== "children_privacy") throw new PortalError("NOT_FOUND");
  const current = await policies(), children = id === "children_privacy";
  return response({ id, version: children ? current.childrenPrivacyVersion : current.privacyVersion,
    title: children ? { zh: "儿童隐私保护", en: "Children's privacy" } : { zh: "隐私保护", en: "Privacy" },
    body: { zh: children ? current.policyText.zh.children : current.policyText.zh.privacy,
      en: children ? current.policyText.en.children : current.policyText.en.privacy } });
}
