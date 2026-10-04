# Base 字段映射清单 · 2026-09-10

范围：两个完整主来源中的 20 张表、345 个字段定义和 5,338 条记录。此清单只含字段名、语义键与汇总数量。所有原记录均已纳入本机整理清单；更早快照的 22 条记录另行保留。

每项写入 `history_source_business_facts.fields`，以来源记录、字段 ID 与映射版本定位；下表的“业务字段”是数组元素中的 `section.key`。规范值和原文共同保存，空白字段保留定义。原始二进制文件及系统字段继续由原档案保存。

主来源：非空原文 92,809 格，另有 1 格仅含原始值；无未分类字段。

“规范值”表示日期、数字、号码、状态等已转换；“文字”表示字段的业务类型本身是文字、来源标签或原选项；“原值表达”表示暂不适合推成精确值。它们均有实际保存位置，不以行覆盖率替代字段覆盖。

转换规则与操作入口见 [Base 全字段业务资料整理](../../runbooks/base-business-field-organization.md)。

## 【重要】窗口期学员数据

来源：2024 11月 寒春续报 学员明细.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 班级 | fldaKZ092i | enrollment.class | label | 126 | 0 | 126 | 0 | 0 |
| 授课教师 | fldJohq3li | support.teacher | label | 125 | 0 | 125 | 0 | 0 |
| 缴费时间 | fldt6Y9d9H | finance.paid_on | date_or_relative | 97 | 97 | 0 | 0 | 0 |
| 父记录 | fldAYnRPKM | reference.parent_record | reference | 0 | 0 | 0 | 0 | 0 |
| 备注 | fldIitutUd | notes.note | text | 85 | 0 | 85 | 0 | 0 |
| 校区 | fldVofIhgb | enrollment.campus | label | 122 | 0 | 122 | 0 | 0 |
| 姓名 | fldc86a1jh | identity.name | text | 124 | 0 | 124 | 0 | 0 |
| 电话 | fldPIkRAlW | identity.phone | phone | 103 | 103 | 0 | 0 | 0 |
| 报名季节 | fldMRjydOi | enrollment.term | period | 98 | 0 | 98 | 0 | 0 |
| 班型 | fldM6nnQMT | enrollment.class_band | class_band | 105 | 105 | 0 | 0 | 0 |
| 沟通方式 | fldH09iwXj | followup.channel | choice | 97 | 0 | 97 | 0 | 0 |
| 缴费金额 | fld2NWNXQN | finance.amount | money | 98 | 98 | 0 | 0 | 0 |
| 年级 | fldouUQ9vP | identity.grade | grade | 105 | 80 | 25 | 0 | 0 |
| 缴费方式 | fldI9ggpfg | finance.payment_method | choice | 89 | 0 | 89 | 0 | 0 |

## 2026秋季在读学员表格

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 校区 | fldYWWs6DI | enrollment.campus | label | 165 | 0 | 165 | 0 | 0 |
| 26秋上课周次 | fld7o6j6Hr | teaching.week | period | 163 | 0 | 163 | 0 | 0 |
| 26秋报名模式 | fldKeVJOWS | enrollment.autumn_2026_mode | choice | 10 | 0 | 10 | 0 | 0 |
| 班型 | fldurEcoo6 | enrollment.class_band | class_band | 165 | 165 | 0 | 0 | 0 |
| 26秋在读 | fldeOKZIs3 | enrollment.autumn_2026_active | boolean | 155 | 155 | 0 | 0 | 0 |
| 年级 | fld4KYfbBJ | identity.grade | grade | 165 | 165 | 0 | 0 | 0 |
| 授课学科老师 | fldWAEbK7U | support.teacher | label | 165 | 0 | 165 | 0 | 0 |
| 报名缴费日期 | fldoSc9ANk | enrollment.registered_on | date | 0 | 0 | 0 | 0 | 0 |
| 姓名 | fldbar92Sl | identity.name | text | 165 | 0 | 165 | 0 | 0 |
| 单师班序（仅多维统计用） | fld94Qqqzq | teaching.class_order | choice | 166 | 0 | 166 | 0 | 0 |
| 报名服务老师 | fldUc132x1 | support.staff | label | 10 | 0 | 10 | 0 | 0 |
| 26秋上课时段 | fldcMTRGLU | teaching.time_slot | text | 163 | 0 | 163 | 0 | 0 |

## 到访数据与信息表1.0-总

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 学服老师 | fldcrSim46 | support.staff | label | 761 | 0 | 761 | 0 | 0 |
| 学习力测评等级 | fld9fgxpDy | assessment.learning_band | band | 111 | 111 | 0 | 0 | 0 |
| 年级/25级 | fldGn6fjFl | identity.grade_2025 | grade | 705 | 637 | 68 | 0 | 1 |
| 测评报告附件 | fldYwHSlfg | assessment.report_files | attachment | 0 | 0 | 0 | 0 | 0 |
| 到访时段 | fldgjPMdjk | visit.time_slot | text | 614 | 0 | 614 | 0 | 0 |
| 学科老师 | flduC9wFP5 | support.teacher | label | 433 | 0 | 433 | 0 | 0 |
| 到访月份 | fldfaOMXkk | visit.month | period | 666 | 0 | 666 | 0 | 0 |
| 报名与否 | fldw1BzMtw | enrollment.confirmed | boolean | 311 | 311 | 0 | 0 | 0 |
| 专题产品 | fldDhCEwuM | visit.product | choice | 15 | 0 | 15 | 0 | 0 |
| 相关附件 | flde6q5M83 | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |
| 校区 | fldAsu3Cws | enrollment.campus | label | 618 | 0 | 618 | 0 | 0 |
| 确认周次 | fld06opqXy | confirmation.week | period | 673 | 0 | 673 | 0 | 0 |
| 英语测评成绩（年级限定下） | flddFEz9DO | assessment.english_score | choice | 18 | 0 | 18 | 0 | 0 |
| 确认日期 | fldfQugCRC | confirmation.occurred_on | date | 650 | 650 | 0 | 0 | 0 |
| 家长情况2 | fldUcp4uMo | assessment.family_background | text | 299 | 0 | 299 | 0 | 0 |
| 推送日期 | fldfqUPK8M | renewal.scholarship_sent_on | date | 16 | 16 | 0 | 0 | 0 |
| 学员情况2 | flds1XloM8 | assessment.student_background | text | 331 | 0 | 331 | 0 | 0 |
| 渠道 | fldniWivZo | acquisition.channel | choice | 604 | 0 | 604 | 0 | 0 |
| 奖学券推送情况 | fld27vDpvp | renewal.scholarship_delivery | multi | 14 | 14 | 0 | 0 | 0 |
| 到访与否 | fldu2UIppJ | visit.attended | boolean | 635 | 635 | 0 | 0 | 0 |
| 确认月份 | fldewfVzZd | confirmation.month | period | 728 | 0 | 728 | 0 | 0 |
| 是否体验/测评英语 | fldfWgngcq | assessment.english_assessed | boolean | 21 | 21 | 0 | 0 | 0 |
| 思维测评等级 | fldnGgcQuf | assessment.math_band | band | 343 | 343 | 0 | 0 | 0 |
| 备考成绩 | fldDPjShkp | assessment.preparation_result | score_or_band | 50 | 50 | 0 | 0 | 0 |
| 报名日期 | flddeKZNIf | enrollment.registered_on | date | 127 | 127 | 0 | 0 | 0 |
| 到访组别 | fldTs5Fc0g | visit.group | label | 690 | 0 | 690 | 0 | 0 |
| 班型 | fldVk2ejR1 | enrollment.class_band | class_band | 142 | 142 | 0 | 0 | 0 |
| 是否列入调价运营对象（临时字段） | fldnx76oyu | renewal.price_campaign_subject | boolean | 49 | 49 | 0 | 0 | 0 |
| 体/测日期 | fldFUDLIJ5 | assessment.occurred_on | date | 16 | 16 | 0 | 0 | 0 |
| 方案宣讲与否 | fldYOmveMa | visit.plan_presented | boolean | 5 | 5 | 0 | 0 | 0 |
| 参与内容 | fldpJICWpH | visit.content | multi | 429 | 429 | 0 | 0 | 0 |
| 到访周次 | fldjuCzMdo | visit.week | period | 619 | 0 | 619 | 0 | 0 |
| 调价运营用户情况 | fldApH12JA | renewal.price_campaign_note | text | 59 | 0 | 59 | 0 | 0 |
| 培养重点&核心期待&共识点 | fldtkjNyk9 | assessment.shared_expectations | text | 16 | 0 | 16 | 0 | 0 |
| 是否报名英语 | fldXXqM7WM | enrollment.english_confirmed | boolean | 11 | 11 | 0 | 0 | 0 |
| 报名月份 | fldVACBy5a | enrollment.month | period | 141 | 0 | 141 | 0 | 0 |
| 沟通日期 | fldH2qyD7K | followup.occurred_on | date | 28 | 28 | 0 | 0 | 0 |
| 家长情况 | fld46V0X0p | assessment.family_background | text | 557 | 0 | 557 | 0 | 0 |
| 家长理念 | fld3p2ChSS | assessment.parent_approach | choice | 340 | 0 | 340 | 0 | 0 |
| 体验测评家长关注点 | fldYfkruQn | assessment.parent_concerns | text | 12 | 0 | 12 | 0 | 0 |
| 选拔交付组别 | flddeEf0RM | visit.group | label | 511 | 0 | 511 | 0 | 0 |
| 就读学校 | fldtXG4SoA | identity.school | text | 586 | 0 | 586 | 0 | 0 |
| 备考情况 | fldWJpSogz | assessment.preparation_status | choice | 5 | 0 | 5 | 0 | 0 |
| 选拔产品 | fldxRrSVcO | visit.product | choice | 611 | 0 | 611 | 0 | 0 |
| 家长报名重视点总结 | fldGqxh6lW | assessment.parent_concerns | text | 4 | 0 | 4 | 0 | 0 |
| 性别 | fld7RWBK8y | identity.gender | gender | 542 | 542 | 0 | 0 | 0 |
| 手机号 | fld7jIItzM | identity.phone | phone | 515 | 515 | 0 | 0 | 0 |
| 学员情况 | fldQ9zzyLb | assessment.student_background | text | 571 | 0 | 571 | 0 | 0 |
| 到访日期 | flde4R1yhp | visit.occurred_on | date | 627 | 627 | 0 | 0 | 0 |
| 其他老师 | fldKpDFVqj | support.other_teacher | label | 26 | 0 | 26 | 0 | 0 |
| 是否沟通英语 | fldJ3GPHox | followup.english_contacted | boolean | 39 | 39 | 0 | 0 | 0 |
| 单人情景再现文档链接 | fldIYBEO6K | assessment.scenario_document | text | 2 | 0 | 2 | 0 | 0 |
| 报名周次 | fld7t9ptIt | enrollment.week | period | 136 | 0 | 136 | 0 | 0 |
| 英语报名日期 | fldNUY44aU | enrollment.english_registered_on | date | 10 | 10 | 0 | 0 | 0 |
| 学员姓名 | fldoAI7aiG | identity.name | text | 708 | 0 | 708 | 0 | 0 |

## 获客&私域信息登记表1.0-总

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 年级/25级 | fldYNf4EOj | identity.grade_2025 | grade | 3454 | 2992 | 462 | 0 | 0 |
| 确认月份 | fldKgI4bOP | confirmation.month | period | 2604 | 0 | 2604 | 0 | 0 |
| 获客组别 | fldO7AkPtA | acquisition.group | label | 3435 | 0 | 3435 | 0 | 0 |
| 报名与否 | fldMsKU1pY | enrollment.confirmed | boolean | 363 | 363 | 0 | 0 | 0 |
| 性别 | fld6Q0ZlhF | identity.gender | gender | 98 | 98 | 0 | 0 | 0 |
| 确认组别 | fldXYQlC8Q | confirmation.group | label | 2787 | 0 | 2787 | 0 | 0 |
| 开团与否 | fldNg7yUyS | acquisition.group_buy_started | boolean | 178 | 178 | 0 | 0 | 0 |
| 到访与否 | fldwNK02fD | visit.attended | boolean | 398 | 398 | 0 | 0 | 0 |
| 确认信息备注 | fldusgD2qP | confirmation.note | text | 2597 | 0 | 2597 | 0 | 0 |
| 团成员手机号 | fldTVgbM4O | acquisition.group_member_phone | phone | 21 | 21 | 0 | 0 | 0 |
| 用户当下加V与否 | fld0s0Silf | followup.wechat_added | boolean | 873 | 873 | 0 | 0 | 0 |
| 跟进信息 | fldcjpCBkG | followup.note | text | 666 | 0 | 666 | 0 | 0 |
| 跟进日期 | fldKyRnLbI | followup.occurred_on | date | 937 | 937 | 0 | 0 | 0 |
| 真题拼团沟通 | fldDgNfMpZ | acquisition.group_buy_contact | choice | 318 | 0 | 318 | 0 | 0 |
| 获取日期 | fldC9AhueH | acquisition.acquired_on | date | 2652 | 2652 | 0 | 0 | 0 |
| 确认人员 | fldUUKxkBz | confirmation.staff | label | 3274 | 0 | 3274 | 0 | 0 |
| 确认日期 | fldxtUfB3m | confirmation.occurred_on | date | 2588 | 2562 | 0 | 26 | 0 |
| 就读学校 | fldgZ1gkAx | identity.school | text | 1507 | 0 | 1507 | 0 | 0 |
| 获客加V情况 | fldfxqSjlo | acquisition.wechat_status | multi | 1395 | 1395 | 0 | 0 | 0 |
| 沟通情况 | fld4o6YHXF | followup.note | text | 311 | 0 | 311 | 0 | 0 |
| 确认周次 | fldAUxZoKg | confirmation.week | period | 2534 | 0 | 2534 | 0 | 0 |
| 真题领取 | fldWYMZgQI | acquisition.materials_received | choice | 28 | 0 | 28 | 0 | 0 |
| 家长电话 | fldMuFQGjf | identity.parent_phone | phone | 3327 | 3327 | 0 | 0 | 0 |
| 跟进月份 | fldWNZ7ZLq | followup.month | period | 1006 | 0 | 1006 | 0 | 0 |
| 跟进人 | fldQ0Og2xs | followup.staff | label | 680 | 0 | 680 | 0 | 0 |
| 诺访与否 | fldUmVyEi7 | followup.visit_committed | boolean | 438 | 438 | 0 | 0 | 0 |
| 跟进结果 | fld85yv2Wc | followup.result | choice | 1126 | 0 | 1126 | 0 | 0 |
| 沟通人员 | fldIQPqVDC | followup.staff | label | 327 | 0 | 327 | 0 | 0 |
| 意向分类 | fldv3jgNL3 | followup.interest | choice | 1888 | 0 | 1888 | 0 | 0 |
| 跟进组别 | fldGS86D0n | followup.group | label | 695 | 0 | 695 | 0 | 0 |
| 学员姓名 | fld4SUKixk | identity.name | text | 3466 | 0 | 3466 | 0 | 0 |
| 获取周次 | fldpWlHnq6 | acquisition.week | period | 2480 | 0 | 2480 | 0 | 0 |
| 获客区位 | fldwsVNGlG | acquisition.location | text | 3051 | 0 | 3051 | 0 | 0 |
| 获取渠道 | fldZBLzBJQ | acquisition.channel | choice | 3120 | 0 | 3120 | 0 | 0 |
| 跟进周次 | fldGIAuMJI | followup.week | period | 966 | 0 | 966 | 0 | 0 |
| 确认结果 | fldF4EpRxu | confirmation.result | multi | 1736 | 1736 | 0 | 0 | 0 |
| 获取月份 | fldnvgwS5B | acquisition.month | period | 3010 | 0 | 3010 | 0 | 0 |
| 获取人员 | fldeZNpvp4 | acquisition.promoter | label | 2671 | 0 | 2671 | 0 | 0 |
| 触达内容 | fldZKvzepl | acquisition.content | text | 2667 | 0 | 2667 | 0 | 0 |
| 当下状态 | fldYymiJYj | followup.current_status | multi | 264 | 264 | 0 | 0 | 0 |

## （老数据）各选拔产品协作信息表-总

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 学员性别 | fldEydDbPK | identity.gender | gender | 99 | 99 | 0 | 0 | 0 |
| 附件 | fldyRk059z | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |
| 初步信息（首轮） | fldvPf3b4i | followup.note | text | 98 | 0 | 98 | 0 | 0 |
| 家长出勤情况 | fld3BJIYEo | visit.parent_attendance | choice | 89 | 0 | 89 | 0 | 0 |
| 参加选拔产品日期 | fldTQS6Eey | visit.occurred_on | date | 99 | 99 | 0 | 0 | 0 |
| 主线服务老师 | fldCURrgWp | support.staff | label | 98 | 0 | 98 | 0 | 0 |
| 散测后试听与否 | fld2gArQbN | visit.trial_after_assessment | boolean | 82 | 82 | 0 | 0 | 0 |
| 校区 | fldt1LsLHu | enrollment.campus | label | 97 | 0 | 97 | 0 | 0 |
| 选拔产品项目 | fldRpTJ35c | visit.content | multi | 98 | 98 | 0 | 0 | 0 |
| 确认日期 | fld9HtLrYl | confirmation.occurred_on | date | 99 | 99 | 0 | 0 | 0 |
| 学员ID | fld4p8U1cc | identity.source_student_id | text | 0 | 0 | 0 | 0 | 0 |
| 家长沟通信息总结（附整理文档） | fldYHU9w61 | assessment.parent_summary | text | 0 | 0 | 0 | 0 | 0 |
| 学员出勤情况 | fldls0UO0W | visit.attended | boolean | 94 | 94 | 0 | 0 | 0 |
| 家长主要关注点 | fldk6XPe1x | assessment.parent_concerns | text | 35 | 0 | 35 | 0 | 0 |
| 年级 | fldLqYHtll | identity.grade | grade | 98 | 97 | 1 | 0 | 0 |
| 测评成绩（分数） | fldyIHCym6 | assessment.score | score_or_band | 15 | 14 | 0 | 1 | 0 |
| 学员姓名 | fldOVsBuSd | identity.name | text | 99 | 0 | 99 | 0 | 0 |
| 时间段 | fldNKybQSc | visit.time_slot | text | 96 | 0 | 96 | 0 | 0 |
| 加V与否（学服） | fldeJ3ZbMb | followup.support_wechat_added | boolean | 99 | 99 | 0 | 0 | 0 |
| 家长体验课旁听 | fldSGOqrYE | visit.parent_trial_attended | boolean | 78 | 78 | 0 | 0 | 0 |
| 学生来源渠道 | fld9UIRDfq | acquisition.channel | choice | 99 | 0 | 99 | 0 | 0 |
| 报名体系与否 | fld6NfLHzj | enrollment.confirmed | boolean | 99 | 99 | 0 | 0 | 0 |
| 家长理念 | fldxNUfJqe | assessment.parent_approach | choice | 42 | 0 | 42 | 0 | 0 |
| 报名选拔产品日期 | fldv5JTKNY | visit.registered_on | date | 97 | 97 | 0 | 0 | 0 |
| 家长说明会参与情况 | fldChSiYqz | visit.parent_orientation_attended | choice | 49 | 0 | 49 | 0 | 0 |
| 加V与否（老师） | fldmgODCU7 | followup.teacher_wechat_added | boolean | 74 | 74 | 0 | 0 | 0 |
| 周次 | fld5cnaTU5 | teaching.week | period | 65 | 0 | 65 | 0 | 0 |
| 学员程度&推荐班型 | fldOhUC5Ke | assessment.recommended_class | choice | 60 | 0 | 60 | 0 | 0 |
| 体系兴趣度 | fldcaB7WRV | followup.interest | choice | 36 | 0 | 36 | 0 | 0 |
| 学服老师 | fld9En0NtY | support.staff | label | 99 | 0 | 99 | 0 | 0 |
| 报名体系日期 | fldEqKPtq7 | enrollment.registered_on | date | 32 | 32 | 0 | 0 | 0 |

## 袋鼠报名与备考信息表

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 就读学校 | fldZqbnnUJ | identity.school | text | 0 | 0 | 0 | 0 | 0 |
| 填写与否 | fldEE5RnEW | competition.form_completed | boolean | 61 | 61 | 0 | 0 | 0 |
| 学员类型 | fldDzr5v0F | identity.student_type | choice | 61 | 0 | 61 | 0 | 0 |
| 短期班期次 | fldVTVFjyo | competition.short_course_term | period | 0 | 0 | 0 | 0 | 0 |
| 竞赛级别 | fldJXzAFwC | competition.level | choice | 0 | 0 | 0 | 0 | 0 |
| 短期班第1次课 | fldpQBw0C5 | competition.lesson_1 | date | 0 | 0 | 0 | 0 | 0 |
| 出生日期 | fldRAK7do2 | identity.birth_date | date | 0 | 0 | 0 | 0 | 0 |
| 非在读-学服 | fldvZsQv5T | support.staff | label | 9 | 0 | 9 | 0 | 0 |
| 姓名 | fldoh31n0W | identity.name | text | 61 | 0 | 61 | 0 | 0 |
| 年级 | fldtEJlp17 | identity.grade | grade | 61 | 61 | 0 | 0 | 0 |
| 卡6 | fldYLeJbN7 | competition.practice_6 | choice | 0 | 0 | 0 | 0 | 0 |
| 卡4 | fld4fHwvAG | competition.practice_4 | choice | 0 | 0 | 0 | 0 | 0 |
| 卡1 | fldAiALoz1 | competition.practice_1 | choice | 0 | 0 | 0 | 0 | 0 |
| 性别 | fldZJEIS9I | identity.gender | gender | 61 | 61 | 0 | 0 | 0 |
| 卡9 | fldX4fFO5Z | competition.practice_9 | choice | 0 | 0 | 0 | 0 | 0 |
| 所在班级 | fldoVkItlI | enrollment.class | label | 0 | 0 | 0 | 0 | 0 |
| 真题领取 | fldEI4RnYm | acquisition.materials_received | choice | 48 | 0 | 48 | 0 | 0 |
| 卡8 | fldjqS7hHZ | competition.practice_8 | choice | 0 | 0 | 0 | 0 | 0 |
| 手机号码 | fldgBgBHgv | identity.phone | phone | 61 | 61 | 0 | 0 | 0 |
| 卡2 | fldVNeeDFp | competition.practice_2 | choice | 0 | 0 | 0 | 0 | 0 |
| 证件号码 | fldSihV6DD | identity.document_number | text | 0 | 0 | 0 | 0 | 0 |
| 备考打卡 | fld2wJXgyO | competition.practice_status | choice | 12 | 0 | 12 | 0 | 0 |
| 思维在读-老师 | fldGexwkYP | support.teacher | label | 52 | 0 | 52 | 0 | 0 |
| 报名日期 | fldiTTDLh1 | enrollment.registered_on | date | 61 | 61 | 0 | 0 | 0 |
| 邮箱 | fldQmm6fCv | identity.email | text | 0 | 0 | 0 | 0 | 0 |
| 卡7 | fldUZR1gjw | competition.practice_7 | choice | 0 | 0 | 0 | 0 | 0 |
| 卡3 | fldnV6dg6S | competition.practice_3 | choice | 0 | 0 | 0 | 0 | 0 |
| 短期班第2次课 | fld84Q2Cex | competition.lesson_2 | date | 0 | 0 | 0 | 0 | 0 |
| 卡5 | fldt3GroRN | competition.practice_5 | choice | 0 | 0 | 0 | 0 | 0 |
| 短期班 | fld9oLKm0v | competition.short_course | choice | 0 | 0 | 0 | 0 | 0 |

## 袋鼠推广

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 题目附件 | fldk4hZRWq | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |
| 沟通基础文案 | fldXYKJ341 | content.communication_copy | text | 1 | 0 | 1 | 0 | 0 |
| 文本 | fldVmyCk9H | reference.template_text | text | 0 | 0 | 0 | 0 | 0 |
| 项目 | fldQIO1p86 | content.project | text | 15 | 0 | 15 | 0 | 0 |
| 海报&PDF附件 | fldwMOslWU | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |

## 学科内容产出表1.0-总

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 月份 | fldv1AJXhW | content.month | period | 52 | 0 | 52 | 0 | 0 |
| 服务类型 | fldT9qt3os | content.service_type | multi | 52 | 52 | 0 | 0 | 0 |
| 方案维度 | fldsAq22cj | content.dimensions | multi | 52 | 52 | 0 | 0 | 0 |
| 产出老师 | fld6bY1hg7 | content.author | label | 52 | 0 | 52 | 0 | 0 |
| 发布日期 | fldyg2JFdY | content.published_on | date | 52 | 52 | 0 | 0 | 0 |
| 内容形态 | fldqzpmBdn | content.format | choice | 52 | 0 | 52 | 0 | 0 |
| 内容主题 | fldCpcm1do | content.topic | text | 52 | 0 | 52 | 0 | 0 |
| 周次 | fld01LvgKH | content.week | period | 52 | 0 | 52 | 0 | 0 |
| 发布渠道 | fld08qiqRN | content.channels | multi | 48 | 48 | 0 | 0 | 0 |
| 备注 | fldY3Wwog4 | notes.note | text | 3 | 0 | 3 | 0 | 0 |
| 用户学段 | fldHsKJS4d | identity.education_stage | choice | 52 | 0 | 52 | 0 | 0 |
| 组别 | fld7DdaG1q | support.group | label | 53 | 0 | 53 | 0 | 0 |

## 运营相关图片-私域可用（公域勿用）

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 说明 | fldjmlssBK | resources.description | text | 2 | 0 | 2 | 0 | 0 |
| 附件 | fldKpJLFme | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |
| 类别 | fldwOB2zk0 | resources.category | choice | 0 | 0 | 0 | 0 | 0 |

## 调价续报与新报用户运营数据表-小学

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 用户沟通情况（授课老师填写项） | fldte4dzVn | renewal.teacher_note | text | 0 | 0 | 0 | 0 | 0 |
| 授课老师 | fldUNniKps | support.teacher | label | 138 | 0 | 138 | 0 | 0 |
| 续&未报家长情况说明 | fldBPrnogZ | renewal.parent_note | text | 1 | 0 | 1 | 0 | 0 |
| 上课开始时间 | fldxk4TEEu | teaching.time_slot | text | 138 | 0 | 138 | 0 | 0 |
| 班型 | fld5SEVEGS | enrollment.class_band | class_band | 138 | 138 | 0 | 0 | 0 |
| 组别 | fldjJvrGL1 | support.group | label | 138 | 0 | 138 | 0 | 0 |
| 配合学服组别 | fldSLiE6wx | support.group | label | 137 | 0 | 137 | 0 | 0 |
| 老师班序（暂按周内时间先后） | fldMbEu3MK | teaching.class_order | choice | 138 | 0 | 138 | 0 | 0 |
| 续报与近期新报情况 | fldCZ4rOrJ | renewal.recent_status | choice | 134 | 0 | 134 | 0 | 0 |
| 校区 | fldUTRMaaJ | enrollment.campus | label | 138 | 0 | 138 | 0 | 0 |
| 学员姓名 | fldS2g47DY | identity.name | text | 138 | 0 | 138 | 0 | 0 |
| 续报与否 | fldmbpH310 | renewal.status | renewal_status | 138 | 138 | 0 | 0 | 0 |
| 配合跟进学服老师 | fldSeOEJEE | support.staff | label | 137 | 0 | 137 | 0 | 0 |
| 用户运营情况（学服老师填写项） | fldxdbm2OD | renewal.support_note | text | 46 | 0 | 46 | 0 | 0 |
| 调价运营结果 | fldjRkI9xk | renewal.price_campaign_result | choice | 23 | 0 | 23 | 0 | 0 |
| 年级 | fldvnrH1Ee | identity.grade | grade | 138 | 138 | 0 | 0 | 0 |
| 特别备注说明 | fldDmabgTb | renewal.special_note | text | 9 | 0 | 9 | 0 | 0 |
| 补续日期 | fld3xFft55 | renewal.late_registered_on | date | 31 | 31 | 0 | 0 | 0 |
| 周次 | fldn4Nq2YX | teaching.week | period | 138 | 0 | 138 | 0 | 0 |
| 学期情况 | fldjp7vLZR | enrollment.term | period | 124 | 0 | 124 | 0 | 0 |
| 学期 | fldcLkRu3A | enrollment.term | period | 0 | 0 | 0 | 0 | 0 |
| 管区 | fldgAsxRNG | support.area | label | 138 | 0 | 138 | 0 | 0 |

## 调价续报与新报用户运营数据表-初中

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 学期情况 | fldjp7vLZR | enrollment.term | period | 15 | 0 | 15 | 0 | 0 |
| 配合跟进学服老师 | fldSeOEJEE | support.staff | label | 0 | 0 | 0 | 0 | 0 |
| 用户沟通情况（授课老师填写项） | fldte4dzVn | renewal.teacher_note | text | 0 | 0 | 0 | 0 | 0 |
| 校区 | fldUTRMaaJ | enrollment.campus | label | 15 | 0 | 15 | 0 | 0 |
| 续报与近期新报情况 | fldCZ4rOrJ | renewal.recent_status | choice | 15 | 0 | 15 | 0 | 0 |
| 年级 | fldvnrH1Ee | identity.grade | grade | 15 | 3 | 12 | 0 | 0 |
| 用户运营情况（学服老师填写项） | fldxdbm2OD | renewal.support_note | text | 0 | 0 | 0 | 0 | 0 |
| 班型 | fld5SEVEGS | enrollment.class_band | class_band | 15 | 15 | 0 | 0 | 0 |
| 调价运营结果 | fldjRkI9xk | renewal.price_campaign_result | choice | 0 | 0 | 0 | 0 | 0 |
| 学员姓名 | fldS2g47DY | identity.name | text | 15 | 0 | 15 | 0 | 0 |
| 特别备注说明 | fldDmabgTb | renewal.special_note | text | 0 | 0 | 0 | 0 | 0 |
| 周次 | fldn4Nq2YX | teaching.week | period | 15 | 0 | 15 | 0 | 0 |
| 上课开始时间 | fldxk4TEEu | teaching.time_slot | text | 15 | 0 | 15 | 0 | 0 |
| 授课老师 | fldUNniKps | support.teacher | label | 15 | 0 | 15 | 0 | 0 |
| 组别 | fldjJvrGL1 | support.group | label | 15 | 0 | 15 | 0 | 0 |
| 续报与否 | fldmbpH310 | renewal.status | renewal_status | 15 | 15 | 0 | 0 | 0 |

## 2026暑秋续报数据表

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 周类 | fldXx3LrcR | teaching.week | period | 114 | 0 | 114 | 0 | 0 |
| 联系方式 | fld8I4KyGs | identity.phone | phone | 114 | 114 | 0 | 0 | 0 |
| 春季年级 | fldlUPRFUA | identity.spring_grade | grade | 114 | 109 | 5 | 0 | 0 |
| 姓名 | fldKO6CwIA | identity.name | text | 114 | 0 | 114 | 0 | 0 |
| 续报类型 | fldG6I8fvQ | renewal.type | choice | 78 | 0 | 78 | 0 | 0 |
| 缴费时间 | fld6yiny2e | finance.paid_on | date_or_relative | 74 | 74 | 0 | 0 | 0 |
| 学段 | fld9scGw77 | identity.education_stage | choice | 114 | 0 | 114 | 0 | 0 |
| 校区 | fldgK4r8qy | enrollment.campus | label | 114 | 0 | 114 | 0 | 0 |
| 缴费通道 | fld6h4ZZ6m | finance.payment_method | choice | 69 | 0 | 69 | 0 | 0 |
| 带课老师 | fldS2MowHk | support.teacher | label | 114 | 0 | 114 | 0 | 0 |
| 上课时间 | fldosKMabz | teaching.class_time | date_or_time | 114 | 0 | 114 | 0 | 0 |
| 未报/连报情况 | fldDFc8C3V | renewal.parent_note | text | 26 | 0 | 26 | 0 | 0 |
| 春季班型 | flds2SG2RZ | enrollment.spring_class_band | class_band | 109 | 109 | 0 | 0 | 0 |
| 是否续报 | fldEuRnasx | renewal.status | renewal_status | 78 | 78 | 0 | 0 | 0 |

## 三组12月前端目标拆解

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 诺访目标 | fldq4lPu41 | operations.visit_commitment_target | number | 5 | 5 | 0 | 0 | 0 |
| 有效兼职人数目标 | fldXv6SeKI | operations.promoter_target | number | 5 | 5 | 0 | 0 | 0 |
| 有效获客目标(确认加V） | fld7oSHbjs | operations.confirmed_wechat_target | number | 5 | 5 | 0 | 0 | 0 |
| 整体获客目标 | fldwkyhlmb | operations.acquisition_target | number | 5 | 5 | 0 | 0 | 0 |
| 报名目标 | fldq3cJfzD | operations.enrollment_target | number | 5 | 5 | 0 | 0 | 0 |
| 到访目标 | fldk0PQzMB | operations.attendance_target | number | 5 | 5 | 0 | 0 | 0 |
| 学服资源数 | fldbCXFMPQ | operations.support_resources | number | 0 | 0 | 0 | 0 | 0 |
| 周期 | fldeMlTypI | operations.period | period | 5 | 0 | 5 | 0 | 0 |
| 摆台点目标 | flduApfjc5 | operations.stall_target | number | 5 | 5 | 0 | 0 | 0 |
| 精准获客目标（直邀诺访） | fldi6xQcac | operations.direct_invitation_target | number | 5 | 5 | 0 | 0 | 0 |
| 新增私域目标（加V） | fldY1MmABq | operations.new_wechat_target | number | 5 | 5 | 0 | 0 | 0 |
| 渠道数目标 | fldJrVTufk | operations.channel_target | number | 5 | 5 | 0 | 0 | 0 |
| 小红书账号数目标 | fldECbJXZI | operations.social_account_target | number | 5 | 5 | 0 | 0 | 0 |

## 解决方案与内容产出框架

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 单选 | fldikdCt5x | reference.template_choice | choice | 0 | 0 | 0 | 0 | 0 |
| 日期 | fldAgr1tuo | reference.template_date | date | 0 | 0 | 0 | 0 | 0 |
| 附件 | fldcQ05cBC | resources.files | attachment | 0 | 0 | 0 | 0 | 0 |
| 文本 | fldZTkDMWk | reference.template_text | text | 0 | 0 | 0 | 0 | 0 |

## 一组学员学习信息

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 讲次 | fldtq8tTbn | teaching.lecture | choice | 1 | 0 | 1 | 0 | 0 |
| 校区 | fldNJjrwYz | enrollment.campus | label | 0 | 0 | 0 | 0 | 0 |
| 拓展情况 | fldBmQUsWk | teaching.extension_note | text | 0 | 0 | 0 | 0 | 0 |
| 加油站情况 | fldRf3nGhb | teaching.practice_note | text | 0 | 0 | 0 | 0 | 0 |
| 班级名称 | fldUmIs9UK | enrollment.class | label | 0 | 0 | 0 | 0 | 0 |
| 性别 | fldvaSE0D4 | identity.gender | gender | 0 | 0 | 0 | 0 | 0 |
| 年度 | fld09DE6AQ | teaching.year | period | 1 | 0 | 1 | 0 | 0 |
| 进门测错误类型 | fldNLwwMMc | teaching.entry_error_type | choice | 1 | 0 | 1 | 0 | 0 |
| 补调情况 | fld1LxhoCw | teaching.makeup_note | text | 0 | 0 | 0 | 0 | 0 |
| 本周书写 | fldW6aDpM9 | teaching.handwriting | choice | 0 | 0 | 0 | 0 | 0 |
| 进门测得分 | fld3iT94XB | teaching.entry_score | score | 1 | 1 | 0 | 0 | 0 |
| 班型 | fld43M8l4E | enrollment.class_band | class_band | 0 | 0 | 0 | 0 | 0 |
| 姓名 | fldpIJxmsO | identity.name | text | 1 | 0 | 1 | 0 | 0 |
| 出勤情况 | fldZkrBFJk | teaching.attendance_note | text | 0 | 0 | 0 | 0 | 0 |
| 家长手机号 | fldeRcTtSZ | identity.parent_phone | phone | 2 | 0 | 0 | 2 | 0 |
| 调课请假与否 | fldizvejlo | teaching.reschedule_or_leave | boolean | 0 | 0 | 0 | 0 | 0 |
| 错题类型 | fldg190wui | teaching.error_type | choice | 0 | 0 | 0 | 0 | 0 |
| 错题预号 | fldIEUHEj3 | teaching.error_question | choice | 1 | 0 | 1 | 0 | 0 |
| 打卡附件 | fldRp4spNI | teaching.practice_files | attachment | 0 | 0 | 0 | 0 | 0 |
| 第3天 | fldezLhTao | teaching.day_3 | choice | 1 | 0 | 1 | 0 | 0 |
| 所在周次 | fldXwVldsR | teaching.week | period | 1 | 0 | 1 | 0 | 0 |
| 第4天 | fldPvRbZSq | teaching.day_4 | choice | 1 | 0 | 1 | 0 | 0 |
| 学期 | fld2R7WSNM | teaching.term | period | 1 | 0 | 1 | 0 | 0 |
| 文本 7 | fldNjzp9hl | reference.template_text | text | 0 | 0 | 0 | 0 | 0 |
| 第6天 | fldZIpmdur | teaching.day_6 | choice | 0 | 0 | 0 | 0 | 0 |
| 所在月份 | fldcXMVVxb | teaching.month | period | 1 | 0 | 1 | 0 | 0 |
| 第1天 | fldvMdvPCl | teaching.day_1 | choice | 0 | 0 | 0 | 0 | 0 |
| 第5天 | fldOKzXw25 | teaching.day_5 | choice | 1 | 0 | 1 | 0 | 0 |
| 计算周总结 | fldyL18N4W | teaching.weekly_calculation_note | text | 0 | 0 | 0 | 0 | 0 |
| 上课时间 | fldWSnB3X9 | teaching.class_time | date_or_time | 1 | 1 | 0 | 0 | 0 |
| 第2天 | flduVlPb4A | teaching.day_2 | choice | 0 | 0 | 0 | 0 | 0 |
| 讲次知识模块 | fldHaDOqe5 | teaching.knowledge_module | choice | 0 | 0 | 0 | 0 | 0 |
| 预习评价 | fld4xbuOVl | teaching.preparation | choice | 1 | 0 | 1 | 0 | 0 |
| 讲次名称 | fldVOeA4hU | teaching.lecture_name | text | 0 | 0 | 0 | 0 | 0 |

## 一组12月前端目标拆解

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 有效兼职人数目标 | fldXv6SeKI | operations.promoter_target | number | 5 | 5 | 0 | 0 | 0 |
| 摆台点目标 | flduApfjc5 | operations.stall_target | number | 5 | 5 | 0 | 0 | 0 |
| 新增私域目标（加V） | fldY1MmABq | operations.new_wechat_target | number | 0 | 0 | 0 | 0 | 0 |
| 周期 | fldeMlTypI | operations.period | period | 5 | 0 | 5 | 0 | 0 |
| 到访目标 | fldk0PQzMB | operations.attendance_target | number | 5 | 5 | 0 | 0 | 0 |
| 整体获客目标 | fldFt1LeRz | operations.acquisition_target | number | 5 | 5 | 0 | 0 | 0 |
| 精准获客目标（直邀诺访） | fldi6xQcac | operations.direct_invitation_target | number | 5 | 5 | 0 | 0 | 0 |
| 渠道数目标 | fldJrVTufk | operations.channel_target | number | 5 | 5 | 0 | 0 | 0 |
| 诺访目标 | fldq4lPu41 | operations.visit_commitment_target | number | 5 | 5 | 0 | 0 | 0 |
| 学服资源数 | fldbCXFMPQ | operations.support_resources | number | 5 | 5 | 0 | 0 | 0 |
| 小红书账号数目标 | fldECbJXZI | operations.social_account_target | number | 5 | 5 | 0 | 0 | 0 |
| 报名目标 | fldq3cJfzD | operations.enrollment_target | number | 5 | 5 | 0 | 0 | 0 |
| 有效获客目标(确认加V） | fld7oSHbjs | operations.confirmed_wechat_target | number | 5 | 5 | 0 | 0 | 0 |

## 一组市场获客信息

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 文本 | fldoPIGceJ | reference.template_text | text | 0 | 0 | 0 | 0 | 0 |

## 一组信息日报

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 信息对应日期 | fldA5LJbpD | operations.reported_on | date | 1 | 1 | 0 | 0 | 0 |
| 日报人 | fldb8KU1r3 | operations.reporter | label | 5 | 0 | 5 | 0 | 0 |
| 当日信息内容 | fld3eZeS3M | operations.daily_note | text | 5 | 0 | 5 | 0 | 0 |
| 解决思路建议 | fldjXuBZet | operations.suggestion | text | 5 | 0 | 5 | 0 | 0 |
| 抄送人 | fldYvN9RrL | operations.copied_staff | label | 5 | 0 | 5 | 0 | 0 |
| 运营场景 | fldaEbUgZM | operations.scenario | text | 1 | 0 | 1 | 0 | 0 |

## 一组教学服务信息

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 班级名称 | fldErFF6Bp | enrollment.class | label | 0 | 0 | 0 | 0 | 0 |
| 班型 | fldOLgu1tD | enrollment.class_band | class_band | 0 | 0 | 0 | 0 | 0 |
| 第一讲次 | fldXo0ey57 | teaching.lecture | choice | 0 | 0 | 0 | 0 | 0 |
| 家长手机号 | fldKND4HR4 | identity.parent_phone | phone | 0 | 0 | 0 | 0 | 0 |
| 学员姓名 | fldhYMzRCJ | identity.name | text | 0 | 0 | 0 | 0 | 0 |
| 性别 | fldBJ0wB6T | identity.gender | gender | 0 | 0 | 0 | 0 | 0 |
| 就读小学 | fldpWxIEMN | identity.school | text | 0 | 0 | 0 | 0 | 0 |

## 二组12月前端目标拆解

来源：2026-09-07【思维】用户与产品运营表.base

| 原字段 | 字段 ID | 业务字段 | 类型 | 非空原文 | 规范值 | 文字 | 原值表达 | 引用 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 渠道数目标 | fldJrVTufk | operations.channel_target | number | 5 | 5 | 0 | 0 | 0 |
| 有效兼职人数目标 | fldXv6SeKI | operations.promoter_target | number | 5 | 5 | 0 | 0 | 0 |
| 精准获客目标（直邀诺访） | fldi6xQcac | operations.direct_invitation_target | number | 5 | 5 | 0 | 0 | 0 |
| 诺访目标 | fldq4lPu41 | operations.visit_commitment_target | number | 5 | 5 | 0 | 0 | 0 |
| 整体获客目标 | fldeuie81Y | operations.acquisition_target | number | 5 | 5 | 0 | 0 | 0 |
| 报名目标 | fldq3cJfzD | operations.enrollment_target | number | 5 | 5 | 0 | 0 | 0 |
| 小红书账号数目标 | fldECbJXZI | operations.social_account_target | number | 5 | 5 | 0 | 0 | 0 |
| 到访目标 | fldk0PQzMB | operations.attendance_target | number | 5 | 5 | 0 | 0 | 0 |
| 学服资源数 | fldbCXFMPQ | operations.support_resources | number | 5 | 5 | 0 | 0 | 0 |
| 新增私域目标（加V） | fldY1MmABq | operations.new_wechat_target | number | 5 | 5 | 0 | 0 | 0 |
| 周期 | fldeMlTypI | operations.period | period | 5 | 0 | 5 | 0 | 0 |
| 有效获客目标(确认加V） | fld7oSHbjs | operations.confirmed_wechat_target | number | 5 | 5 | 0 | 0 | 0 |
| 摆台点目标 | flduApfjc5 | operations.stall_target | number | 5 | 5 | 0 | 0 | 0 |
