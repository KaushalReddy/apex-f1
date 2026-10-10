package dev.apexf1.api.persistence.service;

import dev.apexf1.api.persistence.entity.SessionEntity;
import dev.apexf1.api.persistence.repository.SessionRepository;
import dev.apexf1.api.provider.SessionProvider;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SessionIngestionService {

    private final SessionProvider sessionProvider;
    private final SessionRepository sessionRepository;

    public SessionIngestionService(
            SessionProvider sessionProvider,
            SessionRepository sessionRepository) {
        this.sessionProvider = sessionProvider;
        this.sessionRepository = sessionRepository;
    }

    @Transactional
    public int ingestYear(int year) {
        List<SessionEntity> sessions = sessionProvider.fetchSessions(year);
        sessionRepository.saveAll(sessions);
        return sessions.size();
    }
}
