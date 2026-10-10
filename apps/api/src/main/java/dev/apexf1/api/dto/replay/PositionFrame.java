package dev.apexf1.api.dto.replay;

import java.util.List;

public record PositionFrame(
        int sessionKey,
        String mode,
        long t,
        List<ReplayCar> cars
) {

    public static PositionFrame replay(
            int sessionKey,
            long timestamp,
            List<ReplayCar> cars) {

        return new PositionFrame(
                sessionKey,
                "REPLAY",
                timestamp,
                cars);
    }
}
