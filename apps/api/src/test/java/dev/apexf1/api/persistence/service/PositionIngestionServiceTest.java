package dev.apexf1.api.persistence.service;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.apexf1.api.persistence.repository.PositionSampleRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class PositionIngestionServiceTest {

    @Autowired
    private PositionIngestionService ingestionService;

    @Autowired
    private PositionSampleRepository positionSampleRepository;

    @Test
    void ingestsRealSessionPositions() {
        long from = java.time.Instant.parse("2024-05-26T13:00:00Z").toEpochMilli();
        long to = java.time.Instant.parse("2024-05-26T13:01:00Z").toEpochMilli();

        int samples = ingestionService.ingestWindow(9523, from, to);

        assertTrue(samples > 0);
        assertTrue(positionSampleRepository.count() > 0);
    }
}
