"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { createTeacherMicrocourseAction } from "./actions";
import type { TeacherMicrocourseTopic } from "./data";

const NONE = "__none__";

export function MicrocourseStartPanel({
  sessionId,
  sessionTitle,
  topics,
}: {
  sessionId: string;
  sessionTitle: string;
  topics: TeacherMicrocourseTopic[];
}) {
  const t = useTranslations("teacherMicrocourses");
  const locale = useLocale();
  const router = useRouter();
  const [title, setTitle] = useState(sessionTitle);
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState(1);
  const [courseSeason, setCourseSeason] = useState<number | null>(null);
  const [classType, setClassType] = useState("");
  const [topic, setTopic] = useState(topics[0]?.slug ?? "");
  const [keywords, setKeywords] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const create = () => startTransition(async () => {
    const result = await createTeacherMicrocourseAction({
      sourceSessionId: sessionId,
      title,
      description,
      grade,
      courseSeason,
      classType,
      primaryTopicSlug: topic,
      keywords: keywords.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    });
    if (!result.ok) {
      setMessage(t("actionFailed", { code: result.code }));
      return;
    }
    router.refresh();
  });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-crater" />{t("startTitle")}</CardTitle>
        <CardDescription>{t("startDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Label className="grid gap-1.5 sm:col-span-2">
          <span>{t("title")}</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Label>
        <Label className="grid gap-1.5 sm:col-span-2">
          <span>{t("description")}</span>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={4} />
        </Label>
        <Label className="grid gap-1.5">
          <span>{t("grade")}</span>
          <Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5">
          <span>{t("courseSeason")}</span>
          <Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5">
          <span>{t("primaryTopic")}</span>
          <Select value={topic} onValueChange={setTopic}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{topics.map((item) => <SelectItem key={item.id} value={item.slug}>{locale === "en" ? item.titleEn : item.titleZh}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5">
          <span>{t("classType")}</span>
          <Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} />
        </Label>
        <Label className="grid gap-1.5 sm:col-span-2">
          <span>{t("keywords")}</span>
          <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} />
        </Label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="button" disabled={pending || !title.trim() || !topic} onClick={create}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t("createDraft")}
          </Button>
          {message && <p role="status" className="text-sm text-rose">{message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

