package dev.apexf1.api.provider;

import dev.apexf1.api.persistence.entity.SessionEntity;
import java.util.List;

public interface SessionProvider {

    List<SessionEntity> fetchSessions(int year);
}
