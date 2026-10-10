package dev.apexf1.api.persistence.repository;

import dev.apexf1.api.persistence.entity.SessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SessionRepository extends JpaRepository<SessionEntity, Integer> {
}
