package dev.apexf1.api.persistence.service;

import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.apexf1.api.persistence.repository.SessionRepository;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
@Tag("integration")
class SessionIngestionServiceTest {

    @Autowired
    private SessionIngestionService ingestionService;

    @Autowired
    private SessionRepository sessionRepository;

    @Test
    void ingestsRealHistoricalSessions() {
        int processed = ingestionService.ingestYear(2024);

        assertTrue(processed > 0);
        assertTrue(sessionRepository.count() > 0);
    }
}
