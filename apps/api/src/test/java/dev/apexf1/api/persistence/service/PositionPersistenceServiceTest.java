package dev.apexf1.api.persistence.service;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.apexf1.api.dto.PositionSample;
import dev.apexf1.api.persistence.repository.PositionSampleRepository;
import dev.apexf1.api.provider.OpenF1LocationProvider;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class PositionPersistenceServiceTest {

    @Autowired
    private PositionPersistenceService persistenceService;

    @Autowired
    private PositionSampleRepository repository;

    @Test
    void fetchesAndPersistsRealOpenF1Samples() {
        var provider = new OpenF1LocationProvider(
                new com.fasterxml.jackson.databind.ObjectMapper(),
                "https://api.openf1.org/v1"
        );

        long from = Instant.parse("2024-05-26T13:00:00Z").toEpochMilli();
        long to = Instant.parse("2024-05-26T13:01:00Z").toEpochMilli();

        List<PositionSample> samples =
                provider.fetchWindow(9523, 1, from, to);

        assertTrue(samples.size() > 0);

        int saved = persistenceService.saveSamples(9523, samples);

        assertTrue(saved > 0);
        assertTrue(repository.count() > 0);
    }
}
