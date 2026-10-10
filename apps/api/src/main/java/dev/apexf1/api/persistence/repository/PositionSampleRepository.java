package dev.apexf1.api.persistence.repository;

import dev.apexf1.api.persistence.entity.PositionSampleEntity;
import dev.apexf1.api.persistence.entity.PositionSampleId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PositionSampleRepository
        extends JpaRepository<PositionSampleEntity, PositionSampleId> {
}
