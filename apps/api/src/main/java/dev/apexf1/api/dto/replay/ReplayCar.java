package dev.apexf1.api.dto.replay;

public record ReplayCar(
        int driverNumber,
        double x,
        double y,
        double z,
        long sampleT
) {}
