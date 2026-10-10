package dev.apexf1.api.persistence.entity;

import java.io.Serializable;
import java.util.Objects;

public class PositionSampleId implements Serializable {

    private Integer sessionKey;
    private Integer driverNumber;
    private Long sampleTimeMs;

    public PositionSampleId() {
    }

    public PositionSampleId(
            Integer sessionKey,
            Integer driverNumber,
            Long sampleTimeMs) {
        this.sessionKey = sessionKey;
        this.driverNumber = driverNumber;
        this.sampleTimeMs = sampleTimeMs;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PositionSampleId that)) return false;

        return Objects.equals(sessionKey, that.sessionKey)
                && Objects.equals(driverNumber, that.driverNumber)
                && Objects.equals(sampleTimeMs, that.sampleTimeMs);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sessionKey, driverNumber, sampleTimeMs);
    }
}
