package dev.apexf1.api.persistence.service;

import dev.apexf1.api.persistence.entity.SessionEntity;
import dev.apexf1.api.persistence.repository.SessionRepository;
import dev.apexf1.api.provider.DriverProvider;
import dev.apexf1.api.provider.LocationProvider;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PositionIngestionService {

    private final SessionRepository sessionRepository;
    private final DriverProvider driverProvider;
    private final LocationProvider locationProvider;
    private final PositionPersistenceService persistenceService;

    public PositionIngestionService(
            SessionRepository sessionRepository,
            DriverProvider driverProvider,
            LocationProvider locationProvider,
            PositionPersistenceService persistenceService) {
        this.sessionRepository = sessionRepository;
        this.driverProvider = driverProvider;
        this.locationProvider = locationProvider;
        this.persistenceService = persistenceService;
    }

    @Transactional
    public int ingestSession(int sessionKey) {
        SessionEntity session = sessionRepository.findById(sessionKey)
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "Session not found: " + sessionKey));

        return ingestWindow(
                sessionKey,
                session.getDateStart().toEpochMilli(),
                session.getDateEnd().toEpochMilli());
    }

    @Transactional
    public int ingestWindow(int sessionKey, long fromMs, long toMs) {
        if (fromMs >= toMs) {
            throw new IllegalArgumentException(
                    "fromMs must be before toMs");
        }

        if (!sessionRepository.existsById(sessionKey)) {
            throw new IllegalArgumentException(
                    "Session not found: " + sessionKey);
        }

        List<Integer> drivers =
                driverProvider.fetchDriverNumbers(sessionKey);

        int totalSamples = 0;

        for (Integer driverNumber : drivers) {
            var samples = locationProvider.fetchWindow(
                    sessionKey,
                    driverNumber,
                    fromMs,
                    toMs);

            totalSamples +=
                    persistenceService.saveSamples(sessionKey, samples);
        }

        return totalSamples;
    }
}
