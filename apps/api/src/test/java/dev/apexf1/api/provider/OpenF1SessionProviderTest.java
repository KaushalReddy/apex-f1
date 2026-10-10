package dev.apexf1.api.provider;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.apexf1.api.persistence.entity.SessionEntity;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("integration")
class OpenF1SessionProviderTest {

    @Test
    void fetchesRealHistoricalSessions() {
        var provider = new OpenF1SessionProvider(
                new com.fasterxml.jackson.databind.ObjectMapper(),
                "https://api.openf1.org/v1"
        );

        List<SessionEntity> sessions = provider.fetchSessions(2024);

        assertFalse(sessions.isEmpty());
        assertEquals(2024, sessions.getFirst().getYear());
    }
}
