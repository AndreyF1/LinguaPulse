
export interface Question {
  id: number;
  text: string;
  type: 'radio' | 'checkbox';
  options: string[];
}

export enum HookType {
  REVIEWS = 'REVIEWS',
  DEMO = 'DEMO',
  FEEDBACK = 'FEEDBACK',
}

export interface Hook {
  afterQuestionId: number;
  type: HookType;
}

export enum AppView {
    FUNNEL = 'FUNNEL',
    PAYWALL = 'PAYWALL',
    DIALOGUE = 'DIALOGUE',
    EMAIL_FORM = 'EMAIL_FORM',
    FEEDBACK_SENT = 'FEEDBACK_SENT',
    FEEDBACK_VIEW = 'FEEDBACK_VIEW'
}

export type Answers = Record<number, string | string[]>;
