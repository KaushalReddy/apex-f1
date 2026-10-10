package dev.apexf1.api.persistence.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "sessions")
public class SessionEntity {

    @Id
    private Integer sessionKey;

    private String circuitKey;
    private String sessionName;
    private String sessionType;
    private Integer year;
    private Instant dateStart;
    private Instant dateEnd;

    protected SessionEntity() {
    }

    public SessionEntity(
            Integer sessionKey,
            String circuitKey,
            String sessionName,
            String sessionType,
            Integer year,
            Instant dateStart,
            Instant dateEnd) {
        this.sessionKey = sessionKey;
        this.circuitKey = circuitKey;
        this.sessionName = sessionName;
        this.sessionType = sessionType;
        this.year = year;
        this.dateStart = dateStart;
        this.dateEnd = dateEnd;
    }

    public Integer getSessionKey() {
        return sessionKey;
    }

    public String getCircuitKey() {
        return circuitKey;
    }

    public String getSessionName() {
        return sessionName;
    }

    public String getSessionType() {
        return sessionType;
    }

    public Integer getYear() {
        return year;
    }

    public Instant getDateStart() {
        return dateStart;
    }

    public Instant getDateEnd() {
        return dateEnd;
    }
}
