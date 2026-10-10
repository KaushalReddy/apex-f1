package dev.apexf1.api.persistence.repository;

import dev.apexf1.api.persistence.entity.PositionSampleEntity;
import dev.apexf1.api.persistence.entity.PositionSampleId;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PositionSampleRepository
        extends JpaRepository<PositionSampleEntity, PositionSampleId> {

    List<PositionSampleEntity> findBySessionKeyAndDriverNumberAndSampleTimeMsBetweenOrderBySampleTimeMs(
            Integer sessionKey,
            Integer driverNumber,
            Long fromMs,
            Long toMs);

    List<PositionSampleEntity> findBySessionKeyAndSampleTimeMsBetweenOrderBySampleTimeMs(
            Integer sessionKey,
            Long fromMs,
            Long toMs);
}
