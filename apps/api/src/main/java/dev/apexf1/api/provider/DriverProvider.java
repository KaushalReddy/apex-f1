package dev.apexf1.api.provider;

import java.util.List;

public interface DriverProvider {

    List<Integer> fetchDriverNumbers(int sessionKey);
}
