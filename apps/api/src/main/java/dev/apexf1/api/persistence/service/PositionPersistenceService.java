package dev.apexf1.api.persistence.service;

import dev.apexf1.api.dto.PositionSample;
import dev.apexf1.api.persistence.entity.PositionSampleEntity;
import dev.apexf1.api.persistence.repository.PositionSampleRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PositionPersistenceService {

    private final PositionSampleRepository repository;

    public PositionPersistenceService(PositionSampleRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public int saveSamples(int sessionKey, List<PositionSample> samples) {
        var entities = samples.stream()
                .map(sample -> new PositionSampleEntity(
                        sessionKey,
                        sample.driverNumber(),
                        sample.sampleTimeMs(),
                        sample.x(),
                        sample.y(),
                        sample.z()))
                .toList();

        repository.saveAll(entities);
        return entities.size();
    }
}
