package dev.apexf1.api.persistence.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

@Entity
@Table(name = "position_samples")
@IdClass(PositionSampleId.class)
public class PositionSampleEntity {

    @Id
    private Integer sessionKey;

    @Id
    private Integer driverNumber;

    @Id
    private Long sampleTimeMs;

    private Double x;
    private Double y;
    private Double z;

    protected PositionSampleEntity() {
    }

    public PositionSampleEntity(
            Integer sessionKey,
            Integer driverNumber,
            Long sampleTimeMs,
            Double x,
            Double y,
            Double z) {
        this.sessionKey = sessionKey;
        this.driverNumber = driverNumber;
        this.sampleTimeMs = sampleTimeMs;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public Integer getSessionKey() {
        return sessionKey;
    }

    public Integer getDriverNumber() {
        return driverNumber;
    }

    public Long getSampleTimeMs() {
        return sampleTimeMs;
    }

    public Double getX() {
        return x;
    }

    public Double getY() {
        return y;
    }

    public Double getZ() {
        return z;
    }
}
