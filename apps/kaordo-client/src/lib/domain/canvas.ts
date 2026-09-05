import type { ObjectSummary } from './workspace';

export type CanvasPlacement = ObjectSummary & {
  fill?: string;
  height: number;
  stroke?: string;
  width: number;
  x: number;
  y: number;
};

export type CanvasCamera = {
  centerX: number;
  centerY: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasViewport = {
  height: number;
  scrollLeft: number;
  scrollTop: number;
  width: number;
};
