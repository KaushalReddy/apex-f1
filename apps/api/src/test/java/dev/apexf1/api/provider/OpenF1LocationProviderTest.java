package dev.apexf1.api.provider;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.apexf1.api.dto.PositionSample;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class OpenF1LocationProviderTest {

    @Test
    void fetchesRealHistoricalLocationData() {
        var provider = new OpenF1LocationProvider(
                new com.fasterxml.jackson.databind.ObjectMapper(),
                "https://api.openf1.org/v1"
        );

        long from = Instant.parse("2024-05-26T13:00:00Z").toEpochMilli();
        long to = Instant.parse("2024-05-26T13:01:00Z").toEpochMilli();

        List<PositionSample> samples =
                provider.fetchWindow(9523, 1, from, to);

        assertFalse(samples.isEmpty());
        assertTrue(samples.getFirst().sampleTimeMs() >= from);
        assertTrue(samples.getLast().sampleTimeMs() < to);
    }
}
