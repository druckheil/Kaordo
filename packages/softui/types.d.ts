export interface SoftUiModalController {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface SoftUiToastController {
  show(message: string, options?: Record<string, unknown>): void;
}

export interface SoftUiCarouselController {
  next(): void;
  prev(): void;
  goTo(index: number): void;
  current(): number;
}

export interface SoftUiTourController {
  next(): void;
  prev(): void;
  close(): void;
  goTo(index: number): void;
}

export interface SoftUiRuntime {
  modal(selector: string): SoftUiModalController | null;
  sheet(selector: string): SoftUiModalController | null;
  toast(message: string, options?: Record<string, unknown>): SoftUiToastController | void;
  carousel(selector: string, options?: Record<string, unknown>): SoftUiCarouselController | null;
  sidebar(selector: string): SoftUiModalController | null;
  tour(selector: string, options?: Record<string, unknown>): SoftUiTourController | null;
}

declare global {
  var SoftUI: SoftUiRuntime | undefined;
}

export {};
