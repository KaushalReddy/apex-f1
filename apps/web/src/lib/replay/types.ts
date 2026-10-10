export type ReplayCar = {
  driverNumber: number;
  x: number;
  y: number;
  z: number;
  sampleT: number;
  stale?: boolean;
};

export type PositionFrame = {
  sessionKey: number;
  mode: "LIVE" | "REPLAY";
  t: number;
  coordinateSystem?: string;
  cars: ReplayCar[];
};
