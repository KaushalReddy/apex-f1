package dev.apexf1.api.web;

import dev.apexf1.api.persistence.entity.SessionEntity;
import dev.apexf1.api.persistence.repository.SessionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final SessionRepository sessionRepository;

    public SessionController(SessionRepository sessionRepository) {
        this.sessionRepository = sessionRepository;
    }

    @GetMapping("/{sessionKey}")
    public ResponseEntity<SessionEntity> getSession(
            @PathVariable int sessionKey) {

        return sessionRepository.findById(sessionKey)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
