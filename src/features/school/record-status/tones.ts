/** 学生情况好坏：蓝为完全正向，绿为已约定，黄为进行中，橙为待核对，红为否定或流失，灰为中性；灰虚线表示尚未记录。 */
export type RecordTone = 'positive' | 'agreed' | 'progress' | 'review' | 'negative' | 'neutral';

export const RECORD_TONE_STYLE: Record<RecordTone, string> = {
  positive: 'border-sky-500 bg-sky-500 text-white shadow-sm',
  agreed: 'border-leaf bg-leaf text-white shadow-sm',
  progress: 'border-yellow-400 bg-yellow-300 text-yellow-950 shadow-sm dark:border-yellow-500 dark:bg-yellow-500',
  review: 'border-orange-500 bg-orange-500 text-white shadow-sm',
  negative: 'border-rose bg-rose text-white shadow-sm',
  neutral: 'border-crater/70 bg-line/70 text-muted',
};
export const RECORD_UNKNOWN_STYLE = 'border-dashed border-crater/70 bg-line/70 text-muted';
