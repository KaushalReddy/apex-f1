package dev.apexf1.api.provider;

import dev.apexf1.api.dto.PositionSample;
import java.util.List;

/**
 * Provider abstraction for car locations. OpenF1 is one implementation; the rest of the system
 * (services, WebSocket, replay) depends only on this interface and the normalized DTOs.
 */
public interface LocationProvider {
    /** Historical window [fromMs, toMs) for one driver, ordered by time. */
    List<PositionSample> fetchWindow(int sessionKey, int driverNumber, long fromMs, long toMs);
}
