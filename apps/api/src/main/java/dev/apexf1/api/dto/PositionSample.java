package dev.apexf1.api.dto;

/** Normalized car location sample. Provider-agnostic; see packages/contracts position-frame schema. */
public record PositionSample(int driverNumber, long sampleTimeMs, double x, double y, double z) {}
